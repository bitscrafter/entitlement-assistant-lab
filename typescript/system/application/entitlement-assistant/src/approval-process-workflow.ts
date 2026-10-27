import { WorkflowEntrypoint } from "../../../external/workflows.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import type { Clock } from "../../../port/clock.ts";
import type { Application } from "./application.ts";
import type { ApprovalProcess } from "./approval-process.ts";

/** The part of a Workflow binding the approval process uses (Cloudflare Workflows). */
export interface WorkflowBinding {
  create(options: { readonly id: string; readonly params: object }): Promise<unknown>;
  get(id: string): Promise<{
    sendEvent(event: { readonly type: string; readonly payload: object }): Promise<void>;
    terminate(): Promise<void>;
    status(): Promise<{ readonly status: string }>;
  }>;
}

/** The part of a Workflow step the approval process uses. */
interface ApprovalStep {
  waitForEvent(name: string, options: { readonly type: string; readonly timeout: string }): Promise<unknown>;
  do<Value>(name: string, callback: () => Promise<Value>): Promise<Value>;
}

/** The parameters of an approval process instance. */
interface ApprovalParameters {
  /** How long to wait for the decision, from the start: the approval's deadline as the application's clock sees it. */
  readonly timeout_seconds: number;
}

const DECISION_EVENT = "decision";
const ENDED_STATUSES: ReadonlySet<string> = new Set(["complete", "errored", "terminated"]);

/**
 * The approval process as Cloudflare Workflows (grants-and-approvals D6, K1): one instance per approval, its id the
 * approval's id, so a repeated start finds the instance and a lost one is started by the sweep.
 */
export class WorkflowApprovalProcess implements ApprovalProcess {
  readonly #binding: WorkflowBinding;
  readonly #clock: Clock;

  constructor(binding: WorkflowBinding, clock: Clock) {
    this.#binding = binding;
    this.#clock = clock;
  }

  async start(approvalId: Uuid, expiresAt: Date): Promise<"Started" | "AlreadyStarted"> {
    // At least a second: a start delivered late by the sweep still wakes once, to expire the approval.
    const timeoutSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - this.#clock.now().getTime()) / 1000));
    try {
      await this.#binding.create({ id: approvalId, params: { timeout_seconds: timeoutSeconds } });
      return "Started";
    } catch (error) {
      // The instance exists (its id is the approval's): the start was delivered before (K1; review R2-5).
      const existing = await this.#binding.get(approvalId).then(
        (instance) => instance.status(),
        () => null,
      );
      if (existing !== null) return "AlreadyStarted";
      throw error;
    }
  }

  async deliverDecision(approvalId: Uuid): Promise<void> {
    await this.#unlessEnded(approvalId, (instance) =>
      instance.sendEvent({ type: DECISION_EVENT, payload: {} }),
    );
  }

  async terminate(approvalId: Uuid): Promise<void> {
    await this.#unlessEnded(approvalId, (instance) => instance.terminate());
  }

  /** Acts on the instance; an instance that already ended needs nothing, so the message counts as delivered. */
  async #unlessEnded(
    approvalId: Uuid,
    act: (instance: Awaited<ReturnType<WorkflowBinding["get"]>>) => Promise<void>,
  ): Promise<void> {
    let instance: Awaited<ReturnType<WorkflowBinding["get"]>> | undefined;
    try {
      instance = await this.#binding.get(approvalId);
      await act(instance);
    } catch (error) {
      // An instance that ended needs nothing; the application's sweep applies or expires what it left (review R1-1).
      if (instance !== undefined && ENDED_STATUSES.has((await instance.status()).status)) return;
      throw error;
    }
  }
}

/**
 * The Workflow class of the approval process: it waits for the decision event or the timeout, then has the
 * application apply or expire the approval. It holds no rule; each wake is a use case that re-reads and decides.
 */
export function approvalProcessWorkflow<Environment>(
  applicationFor: (environment: Environment) => Promise<Application>,
) {
  return class ApprovalProcessWorkflow extends WorkflowEntrypoint<Environment, ApprovalParameters> {
    async run(
      event: { readonly payload: ApprovalParameters; readonly instanceId: string },
      step: ApprovalStep,
    ): Promise<void> {
      const approvalId = event.instanceId as Uuid;
      const decided = await step
        .waitForEvent("decision", {
          type: DECISION_EVENT,
          timeout: `${Math.max(1, event.payload.timeout_seconds)} seconds`,
        })
        .then(
          () => true,
          (error: unknown) => {
            // Only the deadline expires the approval (K1: "Execution timed out…"); any other failure is retried.
            if (/timed out/i.test(String(error))) return false;
            throw error;
          },
        );
      await step.do(decided ? "apply" : "expire", async () => {
        const application = await applicationFor(this.env);
        await application.approvalProcessWoke(approvalId, decided ? "decision" : "deadline");
      });
    }
  };
}

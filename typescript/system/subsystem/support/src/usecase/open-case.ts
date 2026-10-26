import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { AuthorizationDecider } from "../../../../port/authorization-decider.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { CaseRepository } from "./case-repository.ts";

export type OpenCaseResult =
  | { readonly kind: "Opened"; readonly caseId: Uuid }
  | { readonly kind: "Forbidden" };

/** Opens a case assigned to the opener (support §3, `case.open`). */
export class OpenCase {
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;
  readonly #cases: CaseRepository;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
    readonly cases: CaseRepository;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
    this.#cases = dependencies.cases;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures The decision on `case.open` is audited (rule every-decision-is-audited); a refusal is `Forbidden`, with
   *          no reason codes for the caller (D4), and nothing is written but its record.
   * @ensures Allowed: the case and its assignment to the opener exist, and a `Succeeded` record follows the decision's,
   *          both naming the case.
   */
  async execute(request: {
    readonly principalAccountId: Uuid;
    readonly sessionId: Uuid | null;
    readonly traceId: string;
  }): Promise<OpenCaseResult> {
    const decision = await this.#decider.decide({
      principal: { kind: "Employee", accountId: request.principalAccountId },
      actionKey: "case.open",
      subjectAccountId: null,
    });
    const caseId = this.#ids.newId();
    const record = (
      outcome: "Allow" | "Deny" | "Conditional" | "Succeeded",
      reasons: readonly string[],
      recordedCaseId: Uuid | null,
    ) =>
      this.#audit.record({
        actorAccountId: request.principalAccountId,
        sessionId: request.sessionId,
        traceId: request.traceId,
        actionKey: "case.open",
        outcome,
        policySetVersion: decision.policySetVersion,
        subjectAccountId: null,
        caseId: recordedCaseId,
        changeRequestId: null,
        detail: {},
        participants: [],
        reasons,
      });
    if (decision.outcome !== "Allow") {
      await record(decision.outcome, decision.reasonCodes, null);
      return { kind: "Forbidden" };
    }
    await record("Allow", [], caseId);
    await this.#cases.open(caseId, this.#ids.newId(), request.principalAccountId, this.#clock.now());
    await record("Succeeded", [], caseId);
    return { kind: "Opened", caseId };
  }
}

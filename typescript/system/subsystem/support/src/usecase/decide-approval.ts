import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { AuthorizationDecider } from "../../../../port/authorization-decider.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { TransactionalOutbox } from "../../../../port/transactional-outbox.ts";
import type { GetCustomerAccount } from "../../../account/src/usecase/get-customer-account.ts";
import type { GetInternalAccountNames } from "../../../account/src/usecase/get-internal-account-names.ts";
import type { ChangeAsked, DenialReason } from "../model/change-request.ts";
import { lockedApproval } from "./approval-process-steps.ts";
import type { Approval, ChangeRequestRepository } from "./change-request-repository.ts";
import { combineDecisions } from "./combined-decision.ts";
import { APPROVAL_PROCESS_DESTINATION } from "./confirm-change-request.ts";

const DECIDE = "approval.decide";

/** How many pending approvals the panel lists at most, earliest deadline first (review R2-4). */
const PANEL_LIMIT = 50;

/** Who acts on approvals, from the verified session (never from the request body). */
export interface ApprovalActor {
  readonly principalAccountId: Uuid;
  readonly sessionId: Uuid | null;
  readonly traceId: string;
}

/** A pending approval as the approvals panel lists it (SU-12, grants-and-approvals D7). */
export interface PendingApproval {
  readonly approvalId: Uuid;
  readonly expiresAt: Date;
  readonly changeRequestId: Uuid;
  readonly change: ChangeAsked;
  readonly previewReasonCodes: readonly string[];
  readonly subject: { readonly accountId: Uuid; readonly displayName: string | null };
  readonly requestedBy: { readonly accountId: Uuid; readonly displayName: string | null };
  readonly confirmedBy: { readonly accountId: Uuid; readonly displayName: string | null } | null;
  readonly requestedAt: Date;
}

/** The approvals a supervisor may decide (SU-12, grants-and-approvals D7). */
export class ListPendingApprovals {
  readonly #decider: AuthorizationDecider;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #getInternalAccountNames: GetInternalAccountNames;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly changeRequests: ChangeRequestRepository;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly getInternalAccountNames: GetInternalAccountNames;
    readonly clock: Clock;
  }) {
    this.#decider = dependencies.decider;
    this.#changeRequests = dependencies.changeRequests;
    this.#getCustomerAccount = dependencies.getCustomerAccount;
    this.#getInternalAccountNames = dependencies.getInternalAccountNames;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures `Forbidden` without `approval.decide` (the list names no account then).
   * @ensures Otherwise every approval still `Pending` in its deadline on an account the approver may read, earliest
   *          deadline first, with its change, the subject's name, and who requested and confirmed it.
   */
  async execute(
    actor: ApprovalActor,
  ): Promise<
    | { readonly kind: "Listed"; readonly approvals: readonly PendingApproval[] }
    | { readonly kind: "Forbidden" }
  > {
    const gate = await this.#decider.decidePermission({
      principal: { kind: "Employee", accountId: actor.principalAccountId },
      actionKey: DECIDE,
    });
    if (gate.outcome !== "Allow") return { kind: "Forbidden" };
    const pending = await this.#changeRequests.pendingApprovals(this.#clock.now(), PANEL_LIMIT);
    const names = await this.#getInternalAccountNames.execute(
      pending.flatMap(({ request }) => [
        request.requestedBy,
        ...(request.confirmedBy === null ? [] : [request.confirmedBy]),
      ]),
    );
    const person = (accountId: Uuid) => ({ accountId, displayName: names.get(accountId) ?? null });
    const approvals: PendingApproval[] = [];
    for (const { approval, request } of pending) {
      // Only approvals on accounts the approver may read are listed (AU-4, AU-6; review R1-5).
      const read = await this.#decider.decide({
        principal: { kind: "Employee", accountId: actor.principalAccountId },
        actionKey: "account.read",
        subjectAccountId: request.subjectAccountId,
      });
      if (read.outcome !== "Allow") continue;
      const subject = await this.#getCustomerAccount.execute(request.subjectAccountId);
      approvals.push({
        approvalId: approval.approvalId,
        expiresAt: approval.expiresAt,
        changeRequestId: request.changeRequestId,
        change: request.change,
        previewReasonCodes: request.previewReasonCodes,
        subject: { accountId: request.subjectAccountId, displayName: subject?.displayName ?? null },
        requestedBy: person(request.requestedBy),
        confirmedBy: request.confirmedBy === null ? null : person(request.confirmedBy),
        requestedAt: request.requestedAt,
      });
    }
    return { kind: "Listed", approvals };
  }
}

export type DecideApprovalResult =
  | {
      readonly kind: "Decided";
      readonly status: "Approved" | "Denied";
      readonly caseId: Uuid;
      readonly outboxMessageIds: readonly Uuid[];
    }
  | { readonly kind: "NotFound" }
  | { readonly kind: "NotPending" }
  | { readonly kind: "Denied"; readonly reasonCodes: readonly string[] };

/** A supervisor approves or denies a pending approval (SU-12, grants-and-approvals D7, D9). */
export class DecideApproval {
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #outbox: TransactionalOutbox;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
    readonly changeRequests: ChangeRequestRepository;
    readonly outbox: TransactionalOutbox;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
    this.#changeRequests = dependencies.changeRequests;
    this.#outbox = dependencies.outbox;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Without `approval.decide`, `NotFound` with one `Deny` record, before the approval is read.
   * @ensures An approval that does not exist, or on an account the approver may not read (recorded), is `NotFound`;
   *          one no longer `Pending`, or past its deadline, is
   *          `NotPending` (D9); the approval stays locked, so a decision and the deadline never both win.
   * @ensures `approval.decide` decided on the subject with who requested and confirmed the change: nobody decides
   *          their own (`policy.no-self-approval`); a refusal is `Denied` with every reason, recorded.
   * @ensures Allowed: the approval `Approved` or `Denied` with its reason and comment, in its deadline; a denial
   *          refuses the request (`support.approval-denied`); an outbox message tells the approval process.
   */
  async execute(
    actor: ApprovalActor & {
      readonly approvalId: Uuid;
      readonly decision: "Approved" | "Denied";
      readonly reason: DenialReason | null;
      readonly comment: string | null;
    },
  ): Promise<DecideApprovalResult> {
    const principal = { kind: "Employee", accountId: actor.principalAccountId } as const;
    const gate = await this.#decider.decidePermission({ principal, actionKey: DECIDE });
    const record = (
      outcome: "Allow" | "Deny" | "Conditional" | "Succeeded",
      reasons: readonly string[],
      policySetVersion: string,
      scope: {
        readonly subjectAccountId: Uuid | null;
        readonly caseId: Uuid | null;
        readonly changeRequestId: Uuid | null;
      },
      detail: Record<string, string> = {},
    ) =>
      this.#audit.record({
        actorAccountId: actor.principalAccountId,
        sessionId: actor.sessionId,
        traceId: actor.traceId,
        actionKey: DECIDE,
        outcome,
        policySetVersion,
        ...scope,
        detail,
        participants: [],
        reasons,
      });
    if (gate.outcome !== "Allow") {
      await record(gate.outcome, gate.reasonCodes, gate.policySetVersion, {
        subjectAccountId: null,
        caseId: null,
        changeRequestId: null,
      });
      return { kind: "NotFound" };
    }
    const locked = await lockedApproval(this.#changeRequests, actor.approvalId);
    if (locked === null) return { kind: "NotFound" };
    const { approval, request } = locked;
    const scope = {
      subjectAccountId: request.subjectAccountId,
      caseId: request.caseId,
      changeRequestId: request.changeRequestId,
    };
    // An approver decides only on an account they may read, and learns nothing else of it (AU-4, AU-6; review R1-5).
    const read = await this.#decider.decide({
      principal,
      actionKey: "account.read",
      subjectAccountId: request.subjectAccountId,
    });
    if (read.outcome !== "Allow") {
      await record(read.outcome, read.reasonCodes, read.policySetVersion, scope);
      return { kind: "NotFound" };
    }
    const at = this.#clock.now();
    if (!isPendingAt(approval, at)) return { kind: "NotPending" };

    const decision = combineDecisions(
      await this.#decider.decide({
        principal,
        actionKey: DECIDE,
        subjectAccountId: request.subjectAccountId,
        context: {
          requesterAccountId: request.requestedBy,
          ...(request.confirmedBy === null ? {} : { confirmerAccountId: request.confirmedBy }),
        },
      }),
      read,
    );
    await record(decision.outcome, decision.reasonCodes, decision.policySetVersion, scope);
    if (decision.outcome !== "Allow") return { kind: "Denied", reasonCodes: decision.reasonCodes };

    const decided = await this.#changeRequests.decideApproval(approval.approvalId, {
      status: actor.decision,
      by: actor.principalAccountId,
      at,
      reason: actor.decision === "Denied" ? actor.reason : null,
      comment: actor.decision === "Denied" ? actor.comment : null,
    });
    if (!decided) return { kind: "NotPending" };
    if (actor.decision === "Denied")
      await this.#changeRequests.end(
        request.changeRequestId,
        ["AwaitingApproval"],
        "Refused",
        "support.approval-denied",
      );
    const messageId = this.#ids.newId();
    await this.#outbox.add({
      messageId,
      destination: APPROVAL_PROCESS_DESTINATION,
      messageType: "decision",
      aggregateId: approval.approvalId,
      payload: { decision: actor.decision },
      createdAt: at,
    });
    await record("Succeeded", [], decision.policySetVersion, scope, {
      decision: actor.decision,
      ...(actor.decision === "Denied" && actor.reason !== null ? { decision_reason: actor.reason } : {}),
    });
    return { kind: "Decided", status: actor.decision, caseId: request.caseId, outboxMessageIds: [messageId] };
  }
}

/** @ensures Whether the approval may still be decided at `at`: `Pending`, before its deadline (D9). */
export function isPendingAt(approval: Approval, at: Date): boolean {
  return approval.status === "Pending" && at < approval.expiresAt;
}

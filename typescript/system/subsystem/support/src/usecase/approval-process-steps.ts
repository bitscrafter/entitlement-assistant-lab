import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { AuthorizationDecider } from "../../../../port/authorization-decider.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { GetGrant } from "../../../entitlement/src/usecase/grant-changes.ts";
import { actionKeyOf } from "../model/change-request.ts";
import { authenticationExpiresAt } from "../model/contact-authentication.ts";
import type { ApplyChangeRequest } from "./apply-change-request.ts";
import type { Approval, ChangeRequest, ChangeRequestRepository } from "./change-request-repository.ts";
import { combineDecisions } from "./combined-decision.ts";
import { changeContextOf, changeDetail } from "./prepare-change-request.ts";

/** The system identity the approval process acts as (grants-and-approvals D8, D9). */
export interface ApprovalProcessActor {
  readonly systemAccountId: Uuid;
  readonly traceId: string;
}

export type ApprovalProcessOutcome =
  | { readonly kind: "Applied"; readonly caseId: Uuid }
  | { readonly kind: "Refused"; readonly caseId: Uuid }
  | { readonly kind: "Stale"; readonly caseId: Uuid }
  | { readonly kind: "Expired"; readonly caseId: Uuid }
  | { readonly kind: "NothingToDo" };

/**
 * The approval and its request, locked until the caller's transaction ends, in the order every action on a case
 * takes: the case, the request, the approval; audit records come last (review R1-3: closing a case holds the case,
 * then records, then locks its requests).
 */
export async function lockedApproval(
  changeRequests: ChangeRequestRepository,
  approvalId: Uuid,
): Promise<{ readonly approval: Approval; readonly request: ChangeRequest } | null> {
  const unlocked = await changeRequests.findApproval(approvalId, "Read");
  if (unlocked === null) return null;
  const unlockedRequest = await changeRequests.find(unlocked.changeRequestId, "Read");
  if (unlockedRequest === null) return null;
  await changeRequests.lockCase(unlockedRequest.caseId);
  const request = await changeRequests.find(unlocked.changeRequestId, "Lock");
  const approval = await changeRequests.findApproval(approvalId, "Lock");
  return approval === null || request === null ? null : { approval, request };
}

function recorderOf(audit: AuditRecorder, actor: ApprovalProcessActor, request: ChangeRequest) {
  return (
    actionKey: string,
    outcome: "Allow" | "Deny" | "Conditional" | "Succeeded" | "Failed",
    reasons: readonly string[],
    policySetVersion: string,
    detail: JsonObject = {},
    participants: readonly { readonly role: "Requester"; readonly accountId: Uuid }[] = [],
  ) =>
    audit.record({
      actorAccountId: actor.systemAccountId,
      sessionId: null,
      traceId: actor.traceId,
      actionKey,
      outcome,
      policySetVersion,
      subjectAccountId: request.subjectAccountId,
      caseId: request.caseId,
      changeRequestId: request.changeRequestId,
      detail,
      participants,
      reasons,
    });
}

/**
 * The system applies an approved change (SU-15, grants-and-approvals D8): what the approval process does when the
 * decision reaches it. Re-reads and re-decides; a duplicate or late wake changes nothing.
 */
export class ApplyApprovedChange {
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #applyChangeRequest: ApplyChangeRequest;
  readonly #getGrant: GetGrant;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
    readonly changeRequests: ChangeRequestRepository;
    readonly applyChangeRequest: ApplyChangeRequest;
    readonly getGrant: GetGrant;
    readonly clock: Clock;
  }) {
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
    this.#changeRequests = dependencies.changeRequests;
    this.#applyChangeRequest = dependencies.applyChangeRequest;
    this.#getGrant = dependencies.getGrant;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures `NothingToDo` unless the approval is `Approved` and its request still `AwaitingApproval`.
   * @ensures The system identity's `change-request.apply` decided and recorded; nothing is applied unless it allows.
   * @ensures The confirmer's decision re-run now with their current permissions, `account.read` on the subject,
   *          `approval_granted`, and the contact's authentication as it stood at confirmation; recorded, naming the
   *          confirmer. A refusal ends the request `Refused` with the first reason.
   * @ensures Allowed: `ApplyChangeRequest` by the system identity (`Stale` cancels the request), recorded under
   *          `change-request.apply`.
   */
  async execute(
    actor: ApprovalProcessActor & { readonly approvalId: Uuid },
  ): Promise<ApprovalProcessOutcome> {
    const locked = await lockedApproval(this.#changeRequests, actor.approvalId);
    if (locked === null) return { kind: "NothingToDo" };
    const { approval, request } = locked;
    if (
      approval.status !== "Approved" ||
      request.status !== "AwaitingApproval" ||
      request.confirmedBy === null
    )
      return { kind: "NothingToDo" };
    const caseId = request.caseId;
    const record = recorderOf(this.#audit, actor, request);

    const applyDecision = await this.#decider.decide({
      principal: { kind: "System", accountId: actor.systemAccountId },
      actionKey: "change-request.apply",
      subjectAccountId: null,
    });
    await record(
      "change-request.apply",
      applyDecision.outcome,
      applyDecision.reasonCodes,
      applyDecision.policySetVersion,
    );
    if (applyDecision.outcome !== "Allow") {
      // The system may no longer apply changes: the request ends rather than wait forever (review R1-8).
      const reason = applyDecision.reasonCodes[0] ?? "access.permission-not-held";
      await this.#changeRequests.end(request.changeRequestId, ["AwaitingApproval"], "Refused", reason);
      await record(
        "change-request.apply",
        "Failed",
        [reason],
        applyDecision.policySetVersion,
        changeDetail(request.change, null),
      );
      return { kind: "Refused", caseId };
    }

    const at = this.#clock.now();
    const change = request.change;
    const grant = change.kind === "CreateGrant" ? null : await this.#getGrant.execute(change.grantId);
    const confirmedAt = request.confirmedAt ?? at;
    const authenticatedAt = request.contactAuthenticatedAt;
    const confirmer = { kind: "Employee", accountId: request.confirmedBy } as const;
    const rerun = combineDecisions(
      await this.#decider.decide({
        principal: confirmer,
        actionKey: actionKeyOf(change.kind),
        subjectAccountId: request.subjectAccountId,
        contactAccountId: request.contactAccountId,
        context: {
          ...changeContextOf(change, grant, at, null),
          // As it stood at confirmation (D8): an approval hours later is not refused for an expired authentication.
          contactAuthenticated:
            authenticatedAt !== null && confirmedAt < authenticationExpiresAt(authenticatedAt),
          approvalGranted: true,
        },
      }),
      await this.#decider.decide({
        principal: confirmer,
        actionKey: "account.read",
        subjectAccountId: request.subjectAccountId,
      }),
    );
    await record(actionKeyOf(change.kind), rerun.outcome, rerun.reasonCodes, rerun.policySetVersion, {}, [
      { role: "Requester", accountId: request.confirmedBy },
    ]);
    const detail = changeDetail(change, grant);
    if (rerun.outcome !== "Allow") {
      const reason = rerun.reasonCodes[0] ?? "support.change-refused";
      await this.#changeRequests.end(request.changeRequestId, ["AwaitingApproval"], "Refused", reason);
      await record("change-request.apply", "Failed", [reason], rerun.policySetVersion, detail);
      return { kind: "Refused", caseId };
    }
    const applied = await this.#applyChangeRequest.execute(request, actor.systemAccountId);
    if (applied.kind === "Stale") {
      await record(
        "change-request.apply",
        "Failed",
        ["support.stale-change-request"],
        rerun.policySetVersion,
        detail,
      );
      return { kind: "Stale", caseId };
    }
    await record("change-request.apply", "Succeeded", [], rerun.policySetVersion, {
      ...detail,
      status: "Applied",
      ...(applied.expiresAt === null ? {} : { expires_at: applied.expiresAt.toISOString() }),
    });
    return { kind: "Applied", caseId };
  }
}

/** The approval's deadline passed with no decision (grants-and-approvals D9): what the timer of its process does. */
export class ExpireApproval {
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
    readonly changeRequests: ChangeRequestRepository;
    readonly clock: Clock;
  }) {
    this.#clock = dependencies.clock;
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
    this.#changeRequests = dependencies.changeRequests;
  }

  /**
   * @ensures `NothingToDo` unless the approval is still `Pending` and its deadline has come: a decision that won the
   *          race stands, and a wake before the deadline (a fault mistaken for the timeout) changes nothing (review
   *          R1-2).
   * @ensures Otherwise, when the system identity may (`approval.expire`, recorded): the approval and its request
   *          `Expired` together (`support.approval-expired`), with a `Succeeded` record.
   */
  async execute(
    actor: ApprovalProcessActor & { readonly approvalId: Uuid },
  ): Promise<ApprovalProcessOutcome> {
    const locked = await lockedApproval(this.#changeRequests, actor.approvalId);
    if (
      locked === null ||
      locked.approval.status !== "Pending" ||
      this.#clock.now() < locked.approval.expiresAt
    )
      return { kind: "NothingToDo" };
    const { approval, request } = locked;
    const record = recorderOf(this.#audit, actor, request);
    const decision = await this.#decider.decide({
      principal: { kind: "System", accountId: actor.systemAccountId },
      actionKey: "approval.expire",
      subjectAccountId: null,
    });
    await record("approval.expire", decision.outcome, decision.reasonCodes, decision.policySetVersion);
    if (decision.outcome !== "Allow") {
      // The system may no longer expire approvals: the approval and its request end rather than stay pending
      // forever, and the sweep moves on (review R2-3).
      const reason = decision.reasonCodes[0] ?? "access.permission-not-held";
      await this.#changeRequests.endApproval(approval.approvalId, "Canceled");
      await this.#changeRequests.end(request.changeRequestId, ["AwaitingApproval"], "Refused", reason);
      return { kind: "Refused", caseId: request.caseId };
    }
    await this.#changeRequests.endApproval(approval.approvalId, "Expired");
    await this.#changeRequests.end(
      request.changeRequestId,
      ["AwaitingApproval"],
      "Expired",
      "support.approval-expired",
    );
    await record("approval.expire", "Succeeded", [], decision.policySetVersion, {
      change_kind: request.change.kind,
    });
    return { kind: "Expired", caseId: request.caseId };
  }
}

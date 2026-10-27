import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { DiffOperation } from "../../../entitlement/src/usecase/entitlement-diffs.ts";
import type { ApprovalStatus, ChangeAsked, ChangeStatus, DenialReason } from "../model/change-request.ts";

/** A change request as Support stores it (support §2; grants-and-approvals D1–D8). */
export interface ChangeRequest {
  readonly changeRequestId: Uuid;
  readonly caseId: Uuid;
  readonly subjectAccountId: Uuid;
  readonly change: ChangeAsked;
  readonly diff: readonly DiffOperation[];
  readonly subjectAccountVersion: number;
  readonly previewOutcome: "Allow" | "Deny" | "Conditional";
  readonly previewReasonCodes: readonly string[];
  readonly status: ChangeStatus;
  readonly statusReason: string | null;
  readonly contactAccountId: Uuid | null;
  /** When the contact authenticated, as it stood at confirmation (D8). */
  readonly contactAuthenticatedAt: Date | null;
  readonly requestedBy: Uuid;
  readonly requestedAt: Date;
  readonly confirmedBy: Uuid | null;
  readonly confirmedAt: Date | null;
  /** The first confirmation's answer, given again to every later one (D4). */
  readonly confirmationResponse: JsonObject | null;
  readonly appliedBy: Uuid | null;
  readonly appliedAt: Date | null;
  readonly createdGrantId: Uuid | null;
}

export interface Approval {
  readonly approvalId: Uuid;
  readonly changeRequestId: Uuid;
  readonly status: ApprovalStatus;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly decidedBy: Uuid | null;
  readonly decidedAt: Date | null;
  readonly decisionReason: DenialReason | null;
  readonly decisionComment: string | null;
}

export type NewChangeRequest = Pick<
  ChangeRequest,
  | "changeRequestId"
  | "caseId"
  | "subjectAccountId"
  | "change"
  | "diff"
  | "subjectAccountVersion"
  | "previewOutcome"
  | "previewReasonCodes"
  | "contactAccountId"
  | "requestedBy"
  | "requestedAt"
>;

export interface ChangeRequestRepository {
  /**
   * Locks a case's row until the caller's transaction ends, as every action on the case does first: approvals and
   * the approval process take it too, so every path locks in one order (case, request, approval, audit chain).
   */
  lockCase(caseId: Uuid): Promise<void>;

  /** @ensures The request is stored, `AwaitingConfirmation`. */
  insert(request: NewChangeRequest): Promise<void>;

  /** @ensures The request, or null; with `lock`, its row locked until the caller's transaction ends. */
  find(changeRequestId: Uuid, lock: "Lock" | "Read"): Promise<ChangeRequest | null>;

  /** @ensures The confirmation is recorded: who, when, the contact's authentication, and the answer to repeat. */
  recordConfirmation(
    changeRequestId: Uuid,
    confirmation: {
      readonly by: Uuid;
      readonly at: Date;
      readonly contactAuthenticatedAt: Date | null;
      readonly response: JsonObject;
      readonly status: "Applied" | "AwaitingApproval";
    },
  ): Promise<void>;

  /** @ensures The request is applied: by whom, when, and the grant it created, if any. */
  recordApplied(
    changeRequestId: Uuid,
    application: { readonly by: Uuid; readonly at: Date; readonly createdGrantId: Uuid | null },
  ): Promise<void>;

  /**
   * @ensures A request still in one of `from` ends with `status` and `reason`.
   * @returns Whether it was in one of `from`.
   */
  end(
    changeRequestId: Uuid,
    from: readonly ChangeStatus[],
    status: "Refused" | "Canceled" | "Expired",
    reason: string | null,
  ): Promise<boolean>;

  /** @ensures The case's requests in one of `statuses`, oldest first, locked until the transaction ends. */
  ofCase(caseId: Uuid, statuses: readonly ChangeStatus[]): Promise<readonly ChangeRequest[]>;

  /** @ensures The approval is stored, `Pending`. */
  insertApproval(approval: {
    readonly approvalId: Uuid;
    readonly changeRequestId: Uuid;
    readonly requestedAt: Date;
    readonly expiresAt: Date;
  }): Promise<void>;

  /** @ensures The approval, or null; with `lock`, its row locked until the caller's transaction ends. */
  findApproval(approvalId: Uuid, lock: "Lock" | "Read"): Promise<Approval | null>;

  /** @ensures The request's approval, or null. */
  approvalOf(changeRequestId: Uuid): Promise<Approval | null>;

  /**
   * Decides a pending approval in its deadline, atomically (D9: the window is checked in the deciding transaction).
   *
   * @returns Whether the approval was `Pending` with `expires_at` after `at`.
   */
  decideApproval(
    approvalId: Uuid,
    decision: {
      readonly status: "Approved" | "Denied";
      readonly by: Uuid;
      readonly at: Date;
      readonly reason: DenialReason | null;
      readonly comment: string | null;
    },
  ): Promise<boolean>;

  /**
   * @ensures A `Pending` approval ends with `status`.
   * @returns Whether it was `Pending`.
   */
  endApproval(approvalId: Uuid, status: "Expired" | "Canceled"): Promise<boolean>;

  /** @ensures At most `limit` approvals `Pending` whose deadline is after `at`, earliest deadline first, with requests. */
  pendingApprovals(
    at: Date,
    limit: number,
  ): Promise<readonly { readonly approval: Approval; readonly request: ChangeRequest }[]>;

  /**
   * @ensures At most `limit` approvals `Approved` at or before `decidedBefore` whose request still awaits approval:
   *          decisions the approval process has not applied (review R1-1).
   */
  approvedNotApplied(decidedBefore: Date, limit: number): Promise<readonly Approval[]>;

  /** @ensures At most `limit` approvals still `Pending` whose deadline is at or before `at`. */
  overdueApprovals(at: Date, limit: number): Promise<readonly Approval[]>;
}

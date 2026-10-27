import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { DiffOperation } from "../../../entitlement/src/usecase/entitlement-diffs.ts";
import type {
  ApprovalStatus,
  ChangeAsked,
  ChangeKind,
  ChangeStatus,
  DenialReason,
} from "../model/change-request.ts";
import type {
  Approval,
  ChangeRequest,
  ChangeRequestRepository,
  NewChangeRequest,
} from "../usecase/change-request-repository.ts";

interface ChangeRequestRow extends Record<string, unknown> {
  readonly change_request_id: Uuid;
  readonly case_id: Uuid;
  readonly subject_account_id: Uuid;
  readonly change_kind: ChangeKind;
  readonly parameters: Record<string, unknown>;
  readonly entitlement_diff: DiffOperation[];
  readonly subject_account_version: number;
  readonly preview_outcome: "Allow" | "Deny" | "Conditional";
  readonly preview_reason_codes: string[];
  readonly change_status: ChangeStatus;
  readonly status_reason: string | null;
  readonly contact_account_id: Uuid | null;
  readonly contact_authenticated_at: Date | null;
  readonly requested_by: Uuid;
  readonly requested_at: Date;
  readonly confirmed_by: Uuid | null;
  readonly confirmed_at: Date | null;
  readonly confirmation_response: JsonObject | null;
  readonly applied_by: Uuid | null;
  readonly applied_at: Date | null;
  readonly created_grant_id: Uuid | null;
}

interface ApprovalRow extends Record<string, unknown> {
  readonly approval_id: Uuid;
  readonly change_request_id: Uuid;
  readonly approval_status: ApprovalStatus;
  readonly requested_at: Date;
  readonly expires_at: Date;
  readonly decided_by: Uuid | null;
  readonly decided_at: Date | null;
  readonly decision_reason: DenialReason | null;
  readonly decision_comment: string | null;
}

/** The parameters column: what the tool asked, in the API's snake_case (api.md §9). */
function parametersOf(change: ChangeAsked): JsonObject {
  switch (change.kind) {
    case "CreateGrant":
      return {
        feature_key: change.featureKey,
        ...(change.quota === undefined ? {} : { quota: change.quota }),
        duration_days: change.durationDays,
        reason: change.reason,
      };
    case "RevokeGrant":
      return { grant_id: change.grantId, reason: change.reason };
    case "ExtendGrant":
      return { grant_id: change.grantId, duration_days: change.durationDays, reason: change.reason };
  }
}

function changeOf(kind: ChangeKind, parameters: Record<string, unknown>): ChangeAsked {
  const reason = String(parameters.reason);
  switch (kind) {
    case "CreateGrant":
      return {
        kind,
        featureKey: String(parameters.feature_key),
        ...(typeof parameters.quota === "number" ? { quota: parameters.quota } : {}),
        durationDays: Number(parameters.duration_days),
        reason,
      };
    case "RevokeGrant":
      return { kind, grantId: String(parameters.grant_id) as Uuid, reason };
    case "ExtendGrant":
      return {
        kind,
        grantId: String(parameters.grant_id) as Uuid,
        durationDays: Number(parameters.duration_days),
        reason,
      };
  }
}

const toRequest = (row: ChangeRequestRow): ChangeRequest => ({
  changeRequestId: row.change_request_id,
  caseId: row.case_id,
  subjectAccountId: row.subject_account_id,
  change: changeOf(row.change_kind, row.parameters),
  diff: row.entitlement_diff,
  subjectAccountVersion: row.subject_account_version,
  previewOutcome: row.preview_outcome,
  previewReasonCodes: row.preview_reason_codes,
  status: row.change_status,
  statusReason: row.status_reason,
  contactAccountId: row.contact_account_id,
  contactAuthenticatedAt: row.contact_authenticated_at,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  confirmedBy: row.confirmed_by,
  confirmedAt: row.confirmed_at,
  confirmationResponse: row.confirmation_response,
  appliedBy: row.applied_by,
  appliedAt: row.applied_at,
  createdGrantId: row.created_grant_id,
});

const toApproval = (row: ApprovalRow): Approval => ({
  approvalId: row.approval_id,
  changeRequestId: row.change_request_id,
  status: row.approval_status,
  requestedAt: row.requested_at,
  expiresAt: row.expires_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  decisionReason: row.decision_reason,
  decisionComment: row.decision_comment,
});

/** A request row read as JSON (`to_jsonb`): its instants come back as text. */
function requestFromJson(row: ChangeRequestRow): ChangeRequestRow {
  const instant = (value: unknown) => (value === null ? null : new Date(String(value)));
  return {
    ...row,
    requested_at: new Date(String(row.requested_at)),
    contact_authenticated_at: instant(row.contact_authenticated_at),
    confirmed_at: instant(row.confirmed_at),
    applied_at: instant(row.applied_at),
  };
}

const lockClause = (lock: "Lock" | "Read") => (lock === "Lock" ? " FOR UPDATE" : "");

export class PostgresChangeRequestRepository implements ChangeRequestRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async lockCase(caseId: Uuid): Promise<void> {
    await this.#connection.query("SELECT case_id FROM support_case WHERE case_id = $1 FOR UPDATE", [caseId]);
  }

  async insert(request: NewChangeRequest): Promise<void> {
    await this.#connection.query(
      `INSERT INTO change_request (change_request_id, case_id, subject_account_id, change_kind, parameters,
                                   entitlement_diff, subject_account_version, preview_outcome, preview_reason_codes,
                                   change_status, contact_account_id, requested_by, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AwaitingConfirmation', $10, $11, $12)`,
      [
        request.changeRequestId,
        request.caseId,
        request.subjectAccountId,
        request.change.kind,
        JSON.stringify(parametersOf(request.change)),
        JSON.stringify(request.diff),
        request.subjectAccountVersion,
        request.previewOutcome,
        JSON.stringify(request.previewReasonCodes),
        request.contactAccountId,
        request.requestedBy,
        request.requestedAt,
      ],
    );
  }

  async find(changeRequestId: Uuid, lock: "Lock" | "Read"): Promise<ChangeRequest | null> {
    const [row] = await this.#connection.query<ChangeRequestRow>(
      `SELECT * FROM change_request WHERE change_request_id = $1${lockClause(lock)}`,
      [changeRequestId],
    );
    return row === undefined ? null : toRequest(row);
  }

  async recordConfirmation(
    changeRequestId: Uuid,
    confirmation: {
      readonly by: Uuid;
      readonly at: Date;
      readonly contactAuthenticatedAt: Date | null;
      readonly response: JsonObject;
      readonly status: "Applied" | "AwaitingApproval";
    },
  ): Promise<void> {
    await this.#connection.query(
      `UPDATE change_request SET confirmed_by = $2, confirmed_at = $3, contact_authenticated_at = $4,
              confirmation_response = $5, change_status = $6
        WHERE change_request_id = $1`,
      [
        changeRequestId,
        confirmation.by,
        confirmation.at,
        confirmation.contactAuthenticatedAt,
        JSON.stringify(confirmation.response),
        confirmation.status,
      ],
    );
  }

  async recordApplied(
    changeRequestId: Uuid,
    application: { readonly by: Uuid; readonly at: Date; readonly createdGrantId: Uuid | null },
  ): Promise<void> {
    await this.#connection.query(
      `UPDATE change_request SET change_status = 'Applied', applied_by = $2, applied_at = $3, created_grant_id = $4
        WHERE change_request_id = $1`,
      [changeRequestId, application.by, application.at, application.createdGrantId],
    );
  }

  async end(
    changeRequestId: Uuid,
    from: readonly ChangeStatus[],
    status: "Refused" | "Canceled" | "Expired",
    reason: string | null,
  ): Promise<boolean> {
    const rows = await this.#connection.query(
      `UPDATE change_request SET change_status = $3, status_reason = $4
        WHERE change_request_id = $1 AND change_status = ANY($2::text[]) RETURNING change_request_id`,
      [changeRequestId, from, status, reason],
    );
    return rows.length === 1;
  }

  async ofCase(caseId: Uuid, statuses: readonly ChangeStatus[]): Promise<readonly ChangeRequest[]> {
    const rows = await this.#connection.query<ChangeRequestRow>(
      `SELECT * FROM change_request WHERE case_id = $1 AND change_status = ANY($2::text[])
        ORDER BY requested_at, change_request_id FOR UPDATE`,
      [caseId, statuses],
    );
    return rows.map(toRequest);
  }

  async insertApproval(approval: {
    readonly approvalId: Uuid;
    readonly changeRequestId: Uuid;
    readonly requestedAt: Date;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.#connection.query(
      `INSERT INTO change_approval (approval_id, change_request_id, approval_status, requested_at, expires_at)
       VALUES ($1, $2, 'Pending', $3, $4)`,
      [approval.approvalId, approval.changeRequestId, approval.requestedAt, approval.expiresAt],
    );
  }

  async findApproval(approvalId: Uuid, lock: "Lock" | "Read"): Promise<Approval | null> {
    const [row] = await this.#connection.query<ApprovalRow>(
      `SELECT * FROM change_approval WHERE approval_id = $1${lockClause(lock)}`,
      [approvalId],
    );
    return row === undefined ? null : toApproval(row);
  }

  async approvalOf(changeRequestId: Uuid): Promise<Approval | null> {
    const [row] = await this.#connection.query<ApprovalRow>(
      "SELECT * FROM change_approval WHERE change_request_id = $1",
      [changeRequestId],
    );
    return row === undefined ? null : toApproval(row);
  }

  async decideApproval(
    approvalId: Uuid,
    decision: {
      readonly status: "Approved" | "Denied";
      readonly by: Uuid;
      readonly at: Date;
      readonly reason: DenialReason | null;
      readonly comment: string | null;
    },
  ): Promise<boolean> {
    const rows = await this.#connection.query(
      `UPDATE change_approval SET approval_status = $2, decided_by = $3, decided_at = $4, decision_reason = $5,
              decision_comment = $6
        WHERE approval_id = $1 AND approval_status = 'Pending' AND expires_at > $4 RETURNING approval_id`,
      [approvalId, decision.status, decision.by, decision.at, decision.reason, decision.comment],
    );
    return rows.length === 1;
  }

  async endApproval(approvalId: Uuid, status: "Expired" | "Canceled"): Promise<boolean> {
    const rows = await this.#connection.query(
      `UPDATE change_approval SET approval_status = $2
        WHERE approval_id = $1 AND approval_status = 'Pending' RETURNING approval_id`,
      [approvalId, status],
    );
    return rows.length === 1;
  }

  async pendingApprovals(
    at: Date,
    limit: number,
  ): Promise<readonly { readonly approval: Approval; readonly request: ChangeRequest }[]> {
    const rows = await this.#connection.query<ApprovalRow & { readonly request: ChangeRequestRow }>(
      `SELECT a.*, to_jsonb(r.*) AS request FROM change_approval a JOIN change_request r USING (change_request_id)
        WHERE a.approval_status = 'Pending' AND a.expires_at > $1
        ORDER BY a.expires_at, a.approval_id LIMIT $2`,
      [at, limit],
    );
    return rows.map((row) => ({
      approval: toApproval(row),
      request: toRequest(requestFromJson(row.request)),
    }));
  }

  async approvedNotApplied(decidedBefore: Date, limit: number): Promise<readonly Approval[]> {
    const rows = await this.#connection.query<ApprovalRow>(
      `SELECT a.* FROM change_approval a JOIN change_request r USING (change_request_id)
        WHERE a.approval_status = 'Approved' AND r.change_status = 'AwaitingApproval' AND a.decided_at <= $1
        ORDER BY a.decided_at, a.approval_id LIMIT $2`,
      [decidedBefore, limit],
    );
    return rows.map(toApproval);
  }

  async overdueApprovals(at: Date, limit: number): Promise<readonly Approval[]> {
    const rows = await this.#connection.query<ApprovalRow>(
      `SELECT * FROM change_approval WHERE approval_status = 'Pending' AND expires_at <= $1
        ORDER BY expires_at, approval_id LIMIT $2`,
      [at, limit],
    );
    return rows.map(toApproval);
  }
}

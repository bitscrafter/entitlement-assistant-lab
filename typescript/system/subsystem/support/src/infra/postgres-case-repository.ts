import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuthenticationKind, AuthenticationMethod } from "../model/contact-authentication.ts";
import type {
  CaseRepository,
  ClosedCase,
  CloseReason,
  ContactAuthentication,
  SupportCase,
} from "../usecase/case-repository.ts";

interface CaseRow extends Record<string, unknown> {
  readonly case_id: Uuid;
  readonly subject_account_id: Uuid | null;
  readonly contact_account_id: Uuid | null;
  readonly contact_authenticated_at: Date | null;
  readonly contact_authentication_kind: AuthenticationKind | null;
  readonly contact_authentication_method: AuthenticationMethod | null;
  readonly contact_authenticated_by: Uuid | null;
  readonly opened_at: Date;
  readonly closed_at: Date | null;
  readonly close_reason: CloseReason | null;
  readonly case_summary: string | null;
  readonly assignee_account_id: Uuid | null;
}

export class PostgresCaseRepository implements CaseRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async open(caseId: Uuid, assignmentId: Uuid, openedBy: Uuid, at: Date): Promise<void> {
    await this.#connection.query(
      "INSERT INTO support_case (case_id, opened_at, opened_by) VALUES ($1, $2, $3)",
      [caseId, at, openedBy],
    );
    await this.#connection.query(
      `INSERT INTO case_assignment (assignment_id, case_id, assignee_account_id, assigned_at, assigned_by)
       VALUES ($1, $2, $3, $4, $3)`,
      [assignmentId, caseId, openedBy, at],
    );
  }

  /** @relies-on db: case_assignment_one_current (at most one current assignment per case) */
  async currentAssignee(
    caseId: Uuid,
  ): Promise<{ readonly exists: boolean; readonly assigneeAccountId: Uuid | null }> {
    const rows = await this.#connection.query<{ assignee_account_id: Uuid | null }>(
      `SELECT a.assignee_account_id FROM support_case c
         LEFT JOIN case_assignment a ON a.case_id = c.case_id AND a.ended_at IS NULL
        WHERE c.case_id = $1`,
      [caseId],
    );
    const [row] = rows;
    return { exists: row !== undefined, assigneeAccountId: row?.assignee_account_id ?? null };
  }

  /** @relies-on db: case_assignment_one_current */
  async find(caseId: Uuid): Promise<SupportCase | null> {
    return this.#select(caseId);
  }

  /**
   * Locks the case row first, then reads the case with its current assignment: the lock is taken before the
   * read, so the read sees what a concurrent action committed while this one waited.
   */
  async findForUpdate(caseId: Uuid): Promise<SupportCase | null> {
    const locked = await this.#connection.query<{ case_id: Uuid }>(
      "SELECT case_id FROM support_case WHERE case_id = $1 FOR UPDATE",
      [caseId],
    );
    return locked.length === 0 ? null : this.#select(caseId);
  }

  /** @relies-on db: case_assignment_one_current */
  async #select(caseId: Uuid): Promise<SupportCase | null> {
    const [row] = await this.#connection.query<CaseRow>(
      `SELECT c.case_id, c.subject_account_id, c.contact_account_id, c.contact_authenticated_at,
              c.contact_authentication_kind, c.contact_authentication_method, c.contact_authenticated_by,
              c.opened_at, c.closed_at, c.close_reason, c.case_summary, a.assignee_account_id
         FROM support_case c
         LEFT JOIN case_assignment a ON a.case_id = c.case_id AND a.ended_at IS NULL
        WHERE c.case_id = $1`,
      [caseId],
    );
    return row === undefined ? null : toSupportCase(row);
  }

  async setSubjectIfUnset(caseId: Uuid, subjectAccountId: Uuid): Promise<boolean> {
    const rows = await this.#connection.query<{ case_id: Uuid }>(
      `UPDATE support_case SET subject_account_id = $2
        WHERE case_id = $1 AND subject_account_id IS NULL RETURNING case_id`,
      [caseId, subjectAccountId],
    );
    return rows.length === 1;
  }

  async setContact(caseId: Uuid, contactAccountId: Uuid): Promise<void> {
    await this.#connection.query(
      `UPDATE support_case SET contact_account_id = $2, contact_authenticated_at = NULL,
              contact_authentication_kind = NULL, contact_authentication_method = NULL,
              contact_authenticated_by = NULL
        WHERE case_id = $1`,
      [caseId, contactAccountId],
    );
  }

  async recordAuthentication(caseId: Uuid, authentication: ContactAuthentication): Promise<void> {
    await this.#connection.query(
      `UPDATE support_case SET contact_authenticated_at = $2, contact_authentication_kind = $3,
              contact_authentication_method = $4, contact_authenticated_by = $5
        WHERE case_id = $1`,
      [
        caseId,
        authentication.authenticatedAt,
        authentication.kind,
        authentication.method,
        authentication.authenticatedBy,
      ],
    );
  }

  async clearAuthentication(caseId: Uuid): Promise<void> {
    await this.#connection.query(
      `UPDATE support_case SET contact_authenticated_at = NULL, contact_authentication_kind = NULL,
              contact_authentication_method = NULL, contact_authenticated_by = NULL
        WHERE case_id = $1`,
      [caseId],
    );
  }

  async close(
    caseId: Uuid,
    closing: { readonly at: Date; readonly by: Uuid; readonly reason: CloseReason; readonly summary: string },
  ): Promise<boolean> {
    const closed = await this.#connection.query<{ case_id: Uuid }>(
      `UPDATE support_case SET closed_at = $2, closed_by = $3, close_reason = $4, case_summary = $5
        WHERE case_id = $1 AND closed_at IS NULL RETURNING case_id`,
      [caseId, closing.at, closing.by, closing.reason, closing.summary],
    );
    if (closed.length === 0) return false;
    await this.#connection.query(
      `UPDATE case_assignment SET ended_at = $2, ended_by = $3, end_reason = 'CaseClosed'
        WHERE case_id = $1 AND ended_at IS NULL`,
      [caseId, closing.at, closing.by],
    );
    return true;
  }

  async recordAccountName(
    nameId: Uuid,
    name: {
      readonly caseId: Uuid;
      readonly accountId: Uuid;
      readonly displayName: string;
      readonly at: Date;
    },
  ): Promise<void> {
    await this.#connection.query(
      `INSERT INTO case_account_name (name_id, case_id, account_id, display_name, recorded_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [nameId, name.caseId, name.accountId, name.displayName, name.at],
    );
  }

  async accountNames(nameIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
    if (nameIds.length === 0) return new Map();
    const rows = await this.#connection.query<{ name_id: Uuid; display_name: string }>(
      "SELECT name_id, display_name FROM case_account_name WHERE name_id = ANY($1)",
      [nameIds],
    );
    return new Map(rows.map((row) => [row.name_id, row.display_name]));
  }

  /** @relies-on db: support_case_closed_by_subject */
  async closedCasesOf(subjectAccountId: Uuid, limit: number): Promise<readonly ClosedCase[]> {
    const rows = await this.#connection.query<{
      case_id: Uuid;
      closed_at: Date;
      closed_by: Uuid;
      close_reason: CloseReason;
      case_summary: string;
    }>(
      `SELECT case_id, closed_at, closed_by, close_reason, case_summary FROM support_case
        WHERE subject_account_id = $1 AND closed_at IS NOT NULL
        ORDER BY closed_at DESC, case_id LIMIT $2`,
      [subjectAccountId, limit],
    );
    return rows.map((row) => ({
      caseId: row.case_id,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      closeReason: row.close_reason,
      summary: row.case_summary,
    }));
  }
}

function toSupportCase(row: CaseRow): SupportCase {
  const authentication =
    row.contact_authenticated_at === null ||
    row.contact_authentication_kind === null ||
    row.contact_authentication_method === null ||
    row.contact_authenticated_by === null
      ? null
      : {
          authenticatedAt: row.contact_authenticated_at,
          kind: row.contact_authentication_kind,
          method: row.contact_authentication_method,
          authenticatedBy: row.contact_authenticated_by,
        };
  return {
    caseId: row.case_id,
    subjectAccountId: row.subject_account_id,
    contactAccountId: row.contact_account_id,
    contactAuthentication: authentication,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    summary: row.case_summary,
    assigneeAccountId: row.assignee_account_id,
  };
}

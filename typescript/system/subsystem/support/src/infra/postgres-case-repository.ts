import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CaseRepository } from "../usecase/case-repository.ts";

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
}

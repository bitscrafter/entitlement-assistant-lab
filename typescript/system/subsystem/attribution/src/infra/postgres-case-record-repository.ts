import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { CaseRecord, CaseRecordRepository } from "../usecase/case-record-repository.ts";

export class PostgresCaseRecordRepository implements CaseRecordRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async recordsOfCase(caseId: Uuid, actionKeys: readonly string[]): Promise<readonly CaseRecord[]> {
    const rows = await this.#connection.query<{
      audit_chain_record_id: Uuid;
      occurred_at: Date;
      actor_account_id: Uuid | null;
      action_key: string;
      audit_outcome: CaseRecord["outcome"];
      subject_account_id: Uuid | null;
      detail: JsonObject;
      reasons: string[];
    }>(
      `SELECT r.audit_chain_record_id, r.occurred_at, r.actor_account_id, r.action_key, r.audit_outcome,
              r.subject_account_id, r.detail,
              coalesce(array_agg(x.reason_code ORDER BY x.reason_code) FILTER (WHERE x.reason_code IS NOT NULL), '{}')
                AS reasons
         FROM audit_chain_record r
         LEFT JOIN audit_reason x ON x.audit_chain_record_id = r.audit_chain_record_id
        WHERE r.case_id = $1 AND r.action_key = ANY($2)
        GROUP BY r.audit_chain_record_id
        ORDER BY r.sequence_number`,
      [caseId, actionKeys],
    );
    return rows.map((row) => ({
      recordId: row.audit_chain_record_id,
      occurredAt: row.occurred_at,
      actorAccountId: row.actor_account_id,
      actionKey: row.action_key,
      outcome: row.audit_outcome,
      subjectAccountId: row.subject_account_id,
      reasons: row.reasons,
      detail: row.detail,
    }));
  }
}

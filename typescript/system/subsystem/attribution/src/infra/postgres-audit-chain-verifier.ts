import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import { recordHash } from "./audit-record-hash.ts";

export type ChainVerification =
  | { readonly intact: true; readonly records: number }
  | { readonly intact: false; readonly firstMismatch: number };

interface RecordRow extends Record<string, unknown> {
  readonly audit_chain_record_id: string;
  readonly sequence_number: string;
  readonly occurred_at: Date;
  readonly actor_account_id: string | null;
  readonly session_id: string | null;
  readonly trace_id: string;
  readonly action_key: string;
  readonly audit_outcome: string;
  readonly policy_set_version: string | null;
  readonly subject_account_id: string | null;
  readonly case_id: string | null;
  readonly change_request_id: string | null;
  readonly detail: JsonObject;
  readonly hash_key_id: string;
  readonly previous_hash: Uint8Array;
  readonly record_hash: Uint8Array;
}

/**
 * Walks the chain in sequence order, recomputing every hash and checking every link (attribution §6).
 *
 * @ensures `intact` only when every record's hash and previous hash match, with no gap in the sequence.
 * @ensures Otherwise names the first record that does not match.
 */
export async function verifyAuditChain(
  connection: PostgresConnection,
  keys: ReadonlyMap<string, CryptoKey>,
): Promise<ChainVerification> {
  const records = await connection.query<RecordRow>(
    "SELECT * FROM audit_chain_record ORDER BY sequence_number",
  );
  let previousHash = new Uint8Array(32);
  let expectedSequence = 1;
  for (const row of records) {
    const sequenceNumber = Number(row.sequence_number);
    const key = keys.get(row.hash_key_id);
    const participants = await connection.query<{ participant_role: string; account_id: string }>(
      "SELECT participant_role, account_id FROM audit_participant WHERE audit_chain_record_id = $1",
      [row.audit_chain_record_id],
    );
    const reasons = await connection.query<{ reason_code: string }>(
      "SELECT reason_code FROM audit_reason WHERE audit_chain_record_id = $1",
      [row.audit_chain_record_id],
    );
    const linked =
      sequenceNumber === expectedSequence && equal(new Uint8Array(row.previous_hash), previousHash);
    const recomputed =
      key === undefined
        ? null
        : await recordHash(
            {
              auditChainRecordId: row.audit_chain_record_id,
              sequenceNumber,
              occurredAt: row.occurred_at,
              actorAccountId: row.actor_account_id,
              sessionId: row.session_id,
              traceId: row.trace_id,
              actionKey: row.action_key,
              auditOutcome: row.audit_outcome,
              policySetVersion: row.policy_set_version,
              subjectAccountId: row.subject_account_id,
              caseId: row.case_id,
              changeRequestId: row.change_request_id,
              detail: row.detail,
              hashKeyId: row.hash_key_id,
              previousHash: new Uint8Array(row.previous_hash),
              participants: participants.map((participant) => ({
                role: participant.participant_role,
                accountId: participant.account_id,
              })),
              reasons: reasons.map((reason) => reason.reason_code),
            },
            key,
          );
    const storedHash = new Uint8Array(row.record_hash);
    if (!linked || recomputed === null || !equal(recomputed, storedHash)) {
      return { intact: false, firstMismatch: sequenceNumber };
    }
    previousHash = storedHash;
    expectedSequence += 1;
  }
  return { intact: true, records: records.length };
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

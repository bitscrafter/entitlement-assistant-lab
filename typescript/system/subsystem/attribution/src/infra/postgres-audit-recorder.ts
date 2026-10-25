import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { AuditEntry, AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { UnitOfWork } from "../../../../port/unit-of-work.ts";
import { recordHash } from "./audit-record-hash.ts";

export interface AuditHashKey {
  readonly keyId: string;
  readonly key: CryptoKey;
}

/** Appends to the one global audit chain in PostgreSQL (attribution §5, §6). */
export class PostgresAuditRecorder implements AuditRecorder {
  readonly #connection: PostgresConnection;
  readonly #unitOfWork: UnitOfWork;
  readonly #idGenerator: IdGenerator;
  readonly #clock: Clock;
  readonly #hashKey: AuditHashKey;

  constructor(dependencies: {
    readonly connection: PostgresConnection;
    readonly unitOfWork: UnitOfWork;
    readonly idGenerator: IdGenerator;
    readonly clock: Clock;
    readonly hashKey: AuditHashKey;
  }) {
    this.#connection = dependencies.connection;
    this.#unitOfWork = dependencies.unitOfWork;
    this.#idGenerator = dependencies.idGenerator;
    this.#clock = dependencies.clock;
    this.#hashKey = dependencies.hashKey;
  }

  /**
   * @relies-on db: audit_chain_record_sequence_unique (a gapless, unforked chain)
   * @relies-on db: audit_chain_record_actor_required (only a failed sign-in lacks an actor)
   */
  record(entry: AuditEntry): Promise<void> {
    return this.#unitOfWork.run(async () => {
      const [head] = await this.#connection.query<{
        last_sequence_number: string;
        last_record_hash: Uint8Array;
      }>(
        "SELECT last_sequence_number, last_record_hash FROM audit_chain_head WHERE chain_head_id = 1 FOR UPDATE",
      );
      if (head === undefined) throw new Error("The audit chain head is missing.");
      const sequenceNumber = Number(head.last_sequence_number) + 1;
      const auditChainRecordId = this.#idGenerator.newId();
      const occurredAt = this.#clock.now();
      const previousHash = new Uint8Array(head.last_record_hash);
      const hash = await recordHash(
        {
          auditChainRecordId,
          sequenceNumber,
          occurredAt,
          actorAccountId: entry.actorAccountId,
          sessionId: entry.sessionId,
          traceId: entry.traceId,
          actionKey: entry.actionKey,
          auditOutcome: entry.outcome,
          policySetVersion: entry.policySetVersion,
          subjectAccountId: entry.subjectAccountId,
          caseId: entry.caseId,
          changeRequestId: entry.changeRequestId,
          detail: entry.detail,
          hashKeyId: this.#hashKey.keyId,
          previousHash,
          participants: entry.participants,
          reasons: entry.reasons,
        },
        this.#hashKey.key,
      );
      await this.#connection.query(
        `INSERT INTO audit_chain_record (
           audit_chain_record_id, sequence_number, occurred_at, actor_account_id, session_id, trace_id, action_key,
           audit_outcome, policy_set_version, subject_account_id, case_id, change_request_id, detail, hash_key_id,
           previous_hash, record_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          auditChainRecordId,
          sequenceNumber,
          occurredAt,
          entry.actorAccountId,
          entry.sessionId,
          entry.traceId,
          entry.actionKey,
          entry.outcome,
          entry.policySetVersion,
          entry.subjectAccountId,
          entry.caseId,
          entry.changeRequestId,
          JSON.stringify(entry.detail),
          this.#hashKey.keyId,
          previousHash,
          hash,
        ],
      );
      // One statement each, whatever the number of rows: the statement count reveals nothing about a record.
      await this.#connection.query(
        `INSERT INTO audit_participant (audit_chain_record_id, participant_role, account_id)
         SELECT $1, role, account FROM unnest($2::text[], $3::uuid[]) AS participant(role, account)`,
        [
          auditChainRecordId,
          entry.participants.map((participant) => participant.role),
          entry.participants.map((participant) => participant.accountId),
        ],
      );
      await this.#connection.query(
        "INSERT INTO audit_reason (audit_chain_record_id, reason_code) SELECT $1, unnest($2::text[])",
        [auditChainRecordId, entry.reasons],
      );
      await this.#connection.query(
        `UPDATE audit_chain_head SET last_sequence_number = $1, last_record_hash = $2, updated_at = $3
          WHERE chain_head_id = 1`,
        [sequenceNumber, hash, occurredAt],
      );
    });
  }
}

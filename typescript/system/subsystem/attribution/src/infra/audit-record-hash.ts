import { canonicalJson } from "../../../../external/canonical-json.ts";
import { toBase64Url } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";

/** The fields of one record as hashed: every column, its participants, and its reasons (attribution §6). */
export interface HashedRecord {
  readonly auditChainRecordId: string;
  readonly sequenceNumber: number;
  readonly occurredAt: Date;
  readonly actorAccountId: string | null;
  readonly sessionId: string | null;
  readonly traceId: string;
  readonly actionKey: string;
  readonly auditOutcome: string;
  readonly policySetVersion: string | null;
  readonly subjectAccountId: string | null;
  readonly caseId: string | null;
  readonly changeRequestId: string | null;
  readonly detail: JsonObject;
  readonly hashKeyId: string;
  readonly previousHash: Uint8Array;
  readonly participants: readonly { readonly role: string; readonly accountId: string }[];
  readonly reasons: readonly string[];
}

/** RFC 3339 UTC with microseconds; the database keeps microseconds, the clock gives milliseconds. */
export function canonicalInstant(instant: Date): string {
  return instant.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

/**
 * The bytes the HMAC covers: the RFC 8785 canonical JSON of the record.
 *
 * @ensures Participants are ordered by role, then account; reasons are ordered.
 */
export function canonicalRecord(record: HashedRecord): string {
  const participants = [...record.participants]
    .sort((left, right) => compare(left.role, right.role) || compare(left.accountId, right.accountId))
    .map((participant) => ({ participant_role: participant.role, account_id: participant.accountId }));
  return canonicalJson({
    audit_chain_record_id: record.auditChainRecordId,
    sequence_number: record.sequenceNumber,
    occurred_at: canonicalInstant(record.occurredAt),
    actor_account_id: record.actorAccountId,
    session_id: record.sessionId,
    trace_id: record.traceId,
    action_key: record.actionKey,
    audit_outcome: record.auditOutcome,
    policy_set_version: record.policySetVersion,
    subject_account_id: record.subjectAccountId,
    case_id: record.caseId,
    change_request_id: record.changeRequestId,
    detail: record.detail,
    hash_key_id: record.hashKeyId,
    previous_hash: toBase64Url(record.previousHash),
    participants,
    reasons: [...record.reasons].sort(compare),
  });
}

/** HMAC-SHA-256 of the canonical record with the key named by `hashKeyId`. */
export async function recordHash(record: HashedRecord, key: CryptoKey): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalRecord(record)));
  return new Uint8Array(signature);
}

/** Imports a raw HMAC-SHA-256 key given as unpadded base64url (a Worker secret). */
export async function importHashKey(keyBase64Url: string): Promise<CryptoKey> {
  const padded = keyBase64Url.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")), (character) =>
    character.charCodeAt(0),
  );
  if (bytes.length < 32) throw new Error("An audit hash key needs at least 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

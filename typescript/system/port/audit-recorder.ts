import type { Uuid } from "../kernel/identifier.ts";
import type { JsonObject } from "../kernel/json.ts";

export type AuditOutcome = "Allow" | "Deny" | "Conditional" | "Succeeded" | "Failed";

export type ParticipantRole = "Contact" | "Requester" | "Approver";

/** One audited event (attribution data model §2). */
export interface AuditEntry {
  /** The account that executed the action; null only for a failed sign-in. */
  readonly actorAccountId: Uuid | null;
  readonly sessionId: Uuid | null;
  readonly traceId: string;
  readonly actionKey: string;
  readonly outcome: AuditOutcome;
  readonly policySetVersion: string | null;
  readonly subjectAccountId: Uuid | null;
  readonly caseId: Uuid | null;
  readonly changeRequestId: Uuid | null;
  /** Typed per action key by its writer; never personal data. */
  readonly detail: JsonObject;
  readonly participants: readonly { readonly role: ParticipantRole; readonly accountId: Uuid }[];
  /** Namespaced reason codes (attribution §4a). */
  readonly reasons: readonly string[];
}

/** Writes audit records; every subsystem reaches Attribution only through this port (CM-17). */
export interface AuditRecorder {
  /**
   * Appends one record to the audit chain, inside the caller's unit of work.
   *
   * @ensures The record commits or rolls back with the caller's transaction.
   * @ensures When the record cannot be written, the call rejects, so the audited action fails with it
   *          (rule audit-fails-closed).
   */
  record(entry: AuditEntry): Promise<void>;
}

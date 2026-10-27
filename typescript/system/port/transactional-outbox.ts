import type { Uuid } from "../kernel/identifier.ts";
import type { JsonObject } from "../kernel/json.ts";

/** A message to deliver after the state change it is about commits (grants-and-approvals D6). */
export interface OutboxMessage {
  readonly messageId: Uuid;
  /** Where the message goes, such as `approval-process`. */
  readonly destination: string;
  /** What the destination is asked to do, such as `start`, `decision`, or `terminate`. */
  readonly messageType: string;
  /** The entity the message is about, such as an approval; delivering is idempotent by it. */
  readonly aggregateId: Uuid;
  /** Ids and codes only, never personal data (AT-7). */
  readonly payload: JsonObject;
  readonly createdAt: Date;
}

/**
 * The transactional outbox: messages written in the transaction of the state change they are about, then delivered
 * at least once, right after commit and by the scheduled sweep.
 */
export interface TransactionalOutbox {
  /** @ensures The message is stored, undelivered, in the caller's unit of work: it commits or rolls back with it. */
  add(message: OutboxMessage): Promise<void>;

  /**
   * @ensures At most `limit` undelivered messages of `destination` created at or before `createdBefore`, oldest
   *          first; a message that failed too often is left for an operator.
   */
  undelivered(destination: string, createdBefore: Date, limit: number): Promise<readonly OutboxMessage[]>;

  /** @ensures These messages of `destination`, undelivered ones only. */
  undeliveredByIds(destination: string, messageIds: readonly Uuid[]): Promise<readonly OutboxMessage[]>;

  /** @ensures The message is delivered at `at`; a delivered message stays as it was. */
  markDelivered(messageId: Uuid, at: Date): Promise<void>;

  /** @ensures One more attempt is counted, with its error. */
  markAttemptFailed(messageId: Uuid, error: string): Promise<void>;
}

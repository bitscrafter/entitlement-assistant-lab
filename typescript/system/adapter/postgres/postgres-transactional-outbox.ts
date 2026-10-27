import type { Uuid } from "../../kernel/identifier.ts";
import type { JsonObject } from "../../kernel/json.ts";
import type { OutboxMessage, TransactionalOutbox } from "../../port/transactional-outbox.ts";
import type { PostgresConnection } from "./postgres-connection.ts";

interface OutboxRow extends Record<string, unknown> {
  readonly message_id: Uuid;
  readonly destination: string;
  readonly message_type: string;
  readonly aggregate_id: Uuid;
  readonly payload: JsonObject;
  readonly created_at: Date;
}

const toMessage = (row: OutboxRow): OutboxMessage => ({
  messageId: row.message_id,
  destination: row.destination,
  messageType: row.message_type,
  aggregateId: row.aggregate_id,
  payload: row.payload,
  createdAt: row.created_at,
});

/**
 * After this many failed attempts a message is no longer redelivered by the sweep: it stays, with its last error,
 * for an operator, so a message that can never be delivered does not crowd out the others (review R1-6).
 */
const MAXIMUM_ATTEMPTS = 50;

const SELECT_MESSAGE =
  "SELECT message_id, destination, message_type, aggregate_id, payload, created_at FROM outbox_message";

/** The transactional outbox in the application's database (`outbox_message`). */
export class PostgresTransactionalOutbox implements TransactionalOutbox {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async add(message: OutboxMessage): Promise<void> {
    await this.#connection.query(
      `INSERT INTO outbox_message (message_id, destination, message_type, aggregate_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        message.messageId,
        message.destination,
        message.messageType,
        message.aggregateId,
        JSON.stringify(message.payload),
        message.createdAt,
      ],
    );
  }

  async undelivered(
    destination: string,
    createdBefore: Date,
    limit: number,
  ): Promise<readonly OutboxMessage[]> {
    const rows = await this.#connection.query<OutboxRow>(
      `${SELECT_MESSAGE} WHERE destination = $1 AND delivered_at IS NULL AND created_at <= $2
          AND attempts < ${MAXIMUM_ATTEMPTS}
        ORDER BY created_at, message_id LIMIT $3`,
      [destination, createdBefore, limit],
    );
    return rows.map(toMessage);
  }

  async undeliveredByIds(
    destination: string,
    messageIds: readonly Uuid[],
  ): Promise<readonly OutboxMessage[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.#connection.query<OutboxRow>(
      `${SELECT_MESSAGE} WHERE destination = $1 AND delivered_at IS NULL AND message_id = ANY($2::uuid[])
        ORDER BY created_at, message_id`,
      [destination, messageIds],
    );
    return rows.map(toMessage);
  }

  async markDelivered(messageId: Uuid, at: Date): Promise<void> {
    await this.#connection.query(
      "UPDATE outbox_message SET delivered_at = $2, attempts = attempts + 1 WHERE message_id = $1 AND delivered_at IS NULL",
      [messageId, at],
    );
  }

  async markAttemptFailed(messageId: Uuid, error: string): Promise<void> {
    await this.#connection.query(
      "UPDATE outbox_message SET attempts = attempts + 1, last_error = $2 WHERE message_id = $1 AND delivered_at IS NULL",
      [messageId, error.slice(0, 500)],
    );
  }
}

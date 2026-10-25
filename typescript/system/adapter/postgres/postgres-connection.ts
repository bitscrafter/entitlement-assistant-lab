import { PostgresClient } from "../../external/postgres.ts";

/** The role created by the application's first migration; every unit of work acts with it. */
export const APPLICATION_DATABASE_ROLE = "entitlement_assistant_app";

export type SqlValue = string | number | boolean | Date | Uint8Array | null | readonly string[];

/**
 * One request's connection to PostgreSQL. Every repository of a request shares it, so that a unit of work
 * spans them all. Through Hyperdrive in the Worker; directly in tests.
 */
export class PostgresConnection {
  readonly #client: PostgresClient;

  private constructor(client: PostgresClient) {
    this.#client = client;
  }

  /** @ensures The connection is open, or the call rejects and nothing stays open. */
  static async open(connectionString: string): Promise<PostgresConnection> {
    const client = new PostgresClient({ connectionString });
    await client.connect();
    return new PostgresConnection(client);
  }

  /** @requires `sql` uses `$n` parameters for every value; values are never interpolated. */
  async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<readonly Row[]> {
    const result = await this.#client.query<Row>(sql, [...parameters]);
    return result.rows;
  }

  async close(): Promise<void> {
    await this.#client.end();
  }
}

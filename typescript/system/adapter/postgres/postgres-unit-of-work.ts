import type { UnitOfWork } from "../../port/unit-of-work.ts";
import type { PostgresConnection } from "./postgres-connection.ts";

/**
 * A unit of work over one request's PostgreSQL connection.
 *
 * With a role, the role is set with `SET LOCAL ROLE` as the transaction's first statement: Hyperdrive pools
 * connections per transaction and resets session settings between them, so only a transaction-scoped role
 * holds for every statement (CM-13).
 */
export class PostgresUnitOfWork implements UnitOfWork {
  readonly #connection: PostgresConnection;
  readonly #role: string | null;
  #depth = 0;

  constructor(connection: PostgresConnection, options: { readonly role: string | null }) {
    this.#connection = connection;
    this.#role = options.role;
  }

  async run<Value>(work: () => Promise<Value>): Promise<Value> {
    if (this.#depth > 0) return this.#joined(work);
    await this.#connection.query("BEGIN");
    try {
      if (this.#role !== null) await this.#connection.query(`SET LOCAL ROLE ${this.#role}`);
      const value = await this.#joined(work);
      await this.#connection.query("COMMIT");
      return value;
    } catch (error) {
      // The work's failure is the one reported, even when the rollback fails too.
      await this.#connection.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async #joined<Value>(work: () => Promise<Value>): Promise<Value> {
    this.#depth += 1;
    try {
      return await work();
    } finally {
      this.#depth -= 1;
    }
  }
}

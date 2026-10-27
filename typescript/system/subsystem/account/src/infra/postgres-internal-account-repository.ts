import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { HoldReason } from "../model/principal.ts";
import type { InternalAccount, InternalAccountRepository } from "../usecase/internal-account-repository.ts";

interface InternalAccountRow extends Record<string, unknown> {
  readonly account_id: string;
  readonly account_display_name: string;
  readonly internal_identity_id: string;
  readonly identity_kind: "Employee" | "System";
}

const SELECT_INTERNAL_ACCOUNT = `
  SELECT a.account_id, a.account_display_name, i.internal_identity_id, i.identity_kind
    FROM internal_account i JOIN account a USING (account_id)`;

export class PostgresInternalAccountRepository implements InternalAccountRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  /** @relies-on db: internal_account_one_per_identity */
  async findByIdentity(internalIdentityId: Uuid): Promise<InternalAccount | null> {
    const [row] = await this.#connection.query<InternalAccountRow>(
      `${SELECT_INTERNAL_ACCOUNT} WHERE i.internal_identity_id = $1`,
      [internalIdentityId],
    );
    return row === undefined ? null : toInternalAccount(row);
  }

  async findById(accountId: Uuid): Promise<InternalAccount | null> {
    const [row] = await this.#connection.query<InternalAccountRow>(
      `${SELECT_INTERNAL_ACCOUNT} WHERE a.account_id = $1`,
      [accountId],
    );
    return row === undefined ? null : toInternalAccount(row);
  }

  async systemAccountIdNamed(name: string): Promise<Uuid | null> {
    const [row] = await this.#connection.query<{ account_id: Uuid }>(
      `SELECT a.account_id FROM system_identity s JOIN internal_account a USING (internal_identity_id)
        WHERE s.name = $1`,
      [name],
    );
    return row?.account_id ?? null;
  }

  async unreleasedHolds(accountId: Uuid): Promise<readonly HoldReason[]> {
    const rows = await this.#connection.query<{ hold_reason: HoldReason }>(
      "SELECT hold_reason FROM account_hold WHERE account_id = $1 AND released_at IS NULL",
      [accountId],
    );
    return rows.map((row) => row.hold_reason);
  }
}

function toInternalAccount(row: InternalAccountRow): InternalAccount {
  return {
    accountId: row.account_id as Uuid,
    accountDisplayName: row.account_display_name,
    internalIdentityId: row.internal_identity_id as Uuid,
    identityKind: row.identity_kind,
  };
}

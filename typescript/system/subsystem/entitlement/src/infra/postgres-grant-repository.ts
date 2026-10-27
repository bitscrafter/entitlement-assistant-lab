import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { GrantEndReason, GrantRepository, NewGrant, StoredGrant } from "../usecase/grant-repository.ts";

interface GrantRow extends Record<string, unknown> {
  readonly grant_id: Uuid;
  readonly account_id: Uuid;
  readonly feature_key: string;
  readonly quota: number | null;
  readonly starts_at: Date;
  readonly expires_at: Date;
  readonly ended_at: Date | null;
  readonly end_reason: GrantEndReason | null;
  readonly extends_grant_id: Uuid | null;
}

const SELECT_GRANT = `
  SELECT g.grant_id, s.account_id, g.feature_key, g.quota, g.starts_at, g.expires_at, g.ended_at, g.end_reason,
         g.extends_grant_id
    FROM entitlement_grant g JOIN subscription s USING (subscription_id)`;

const toGrant = (row: GrantRow): StoredGrant => ({
  grantId: row.grant_id,
  accountId: row.account_id,
  featureKey: row.feature_key,
  quota: row.quota,
  startsAt: row.starts_at,
  expiresAt: row.expires_at,
  endedAt: row.ended_at,
  endReason: row.end_reason,
  extendsGrantId: row.extends_grant_id,
});

export class PostgresGrantRepository implements GrantRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async find(grantId: Uuid): Promise<StoredGrant | null> {
    const [row] = await this.#connection.query<GrantRow>(`${SELECT_GRANT} WHERE g.grant_id = $1`, [grantId]);
    return row === undefined ? null : toGrant(row);
  }

  async subscriptionInForce(accountId: Uuid, at: Date): Promise<Uuid | null> {
    const [row] = await this.#connection.query<{ subscription_id: Uuid }>(
      `SELECT subscription_id FROM subscription
        WHERE account_id = $1 AND started_at <= $2 AND (ended_at IS NULL OR ended_at > $2)`,
      [accountId, at],
    );
    return row?.subscription_id ?? null;
  }

  async insert(grant: NewGrant): Promise<void> {
    await this.#connection.query(
      `INSERT INTO entitlement_grant (grant_id, subscription_id, feature_key, quota, reason, granted_by, starts_at,
                                      expires_at, extends_grant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        grant.grantId,
        grant.subscriptionId,
        grant.featureKey,
        grant.quota,
        grant.reason,
        grant.grantedBy,
        grant.startsAt,
        grant.expiresAt,
        grant.extendsGrantId,
      ],
    );
  }

  async end(
    grantId: Uuid,
    ending: { readonly at: Date; readonly by: Uuid; readonly reason: GrantEndReason },
  ): Promise<boolean> {
    const rows = await this.#connection.query(
      `UPDATE entitlement_grant SET ended_at = $2, ended_by = $3, end_reason = $4
        WHERE grant_id = $1 AND ended_at IS NULL RETURNING grant_id`,
      [grantId, ending.at, ending.by, ending.reason],
    );
    return rows.length === 1;
  }

  async expiredNotEnded(at: Date, limit: number): Promise<readonly StoredGrant[]> {
    const rows = await this.#connection.query<GrantRow>(
      `${SELECT_GRANT} WHERE g.ended_at IS NULL AND g.expires_at <= $1 ORDER BY g.expires_at, g.grant_id LIMIT $2`,
      [at, limit],
    );
    return rows.map(toGrant);
  }
}

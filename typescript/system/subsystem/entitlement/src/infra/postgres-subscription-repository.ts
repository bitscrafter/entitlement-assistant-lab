import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EntitlementGrant, Subscription, TermSource } from "../model/effective-entitlements.ts";
import type { SubscriptionRepository } from "../usecase/subscription-repository.ts";

export class PostgresSubscriptionRepository implements SubscriptionRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async grantsOf(accountId: Uuid, featureKey: string, since: Date): Promise<readonly EntitlementGrant[]> {
    const rows = await this.#connection.query<{
      grant_id: Uuid;
      feature_key: string;
      quota: number | null;
      starts_at: Date;
      expires_at: Date;
      ended_at: Date | null;
    }>(
      `SELECT g.grant_id, g.feature_key, g.quota, g.starts_at, g.expires_at, g.ended_at
         FROM entitlement_grant g JOIN subscription s USING (subscription_id)
        WHERE s.account_id = $1 AND g.feature_key = $2 AND least(g.expires_at, coalesce(g.ended_at, g.expires_at)) > $3
        ORDER BY g.starts_at, g.grant_id`,
      [accountId, featureKey, since],
    );
    return rows.map((grant) => ({
      grantId: grant.grant_id,
      featureKey: grant.feature_key,
      quota: grant.quota,
      startsAt: grant.starts_at,
      expiresAt: grant.expires_at,
      endedAt: grant.ended_at,
    }));
  }

  /** @relies-on db: subscription_one_in_force (at most one subscription not ended per account) */
  async latestOf(accountId: Uuid): Promise<Subscription | null> {
    const [subscription] = await this.#connection.query<{
      subscription_id: Uuid;
      started_at: Date;
      ended_at: Date | null;
      end_reason: "Canceled" | "CustomerRemoved" | null;
    }>(
      `SELECT subscription_id, started_at, ended_at, end_reason FROM subscription
        WHERE account_id = $1 ORDER BY started_at DESC, subscription_id DESC LIMIT 1`,
      [accountId],
    );
    if (subscription === undefined) return null;
    const id = [subscription.subscription_id];
    const terms = await this.#connection.query<{
      plan_key: string;
      source: TermSource;
      starts_at: Date;
      scheduled_end_at: Date | null;
      ended_at: Date | null;
    }>(
      "SELECT plan_key, source, starts_at, scheduled_end_at, ended_at FROM subscription_term WHERE subscription_id = $1 ORDER BY starts_at",
      id,
    );
    const addons = await this.#connection.query<{
      addon_key: string;
      started_at: Date;
      ended_at: Date | null;
    }>(
      "SELECT addon_key, started_at, ended_at FROM subscription_addon WHERE subscription_id = $1 ORDER BY started_at",
      id,
    );
    const grants = await this.#connection.query<{
      grant_id: Uuid;
      feature_key: string;
      quota: number | null;
      starts_at: Date;
      expires_at: Date;
      ended_at: Date | null;
    }>(
      `SELECT grant_id, feature_key, quota, starts_at, expires_at, ended_at FROM entitlement_grant
        WHERE subscription_id = $1 ORDER BY starts_at`,
      id,
    );
    return {
      startedAt: subscription.started_at,
      endedAt: subscription.ended_at,
      endReason: subscription.end_reason,
      terms: terms.map((term) => ({
        planKey: term.plan_key,
        source: term.source,
        startsAt: term.starts_at,
        scheduledEndAt: term.scheduled_end_at,
        endedAt: term.ended_at,
      })),
      addons: addons.map((addon) => ({
        addonKey: addon.addon_key,
        startedAt: addon.started_at,
        endedAt: addon.ended_at,
      })),
      grants: grants.map((grant) => ({
        grantId: grant.grant_id,
        featureKey: grant.feature_key,
        quota: grant.quota,
        startsAt: grant.starts_at,
        expiresAt: grant.expires_at,
        endedAt: grant.ended_at,
      })),
    };
  }
}

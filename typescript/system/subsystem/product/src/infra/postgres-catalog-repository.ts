import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Bundle, Catalog } from "../model/catalog.ts";
import type { CatalogRepository } from "../usecase/catalog-repository.ts";

interface BundleRow extends Record<string, unknown> {
  readonly owner_key: string;
  readonly feature_key: string;
  readonly quota: number | null;
}

export class PostgresCatalogRepository implements CatalogRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async load(): Promise<Catalog> {
    const features = await this.#connection.query<{
      feature_key: string;
      product_key: string;
      metered_unit: string | null;
      operations: string[];
    }>(
      `SELECT f.feature_key, f.product_key, f.metered_unit,
              coalesce(array_agg(o.operation ORDER BY o.operation) FILTER (WHERE o.operation IS NOT NULL), '{}') AS operations
         FROM feature f LEFT JOIN feature_operation o USING (feature_key)
        GROUP BY f.feature_key ORDER BY f.feature_key`,
    );
    const plans = await this.#connection.query<{
      plan_key: string;
      plan_ladder_key: string;
      tier_rank: number;
      plan_category: "Free" | "Paid";
    }>(
      "SELECT plan_key, plan_ladder_key, tier_rank, plan_category FROM plan ORDER BY plan_ladder_key, tier_rank",
    );
    const planBundles = await this.#connection.query<BundleRow>(
      "SELECT plan_key AS owner_key, feature_key, quota FROM plan_feature_bundle ORDER BY feature_key",
    );
    const addons = await this.#connection.query<{ addon_key: string; eligible_plan_keys: string[] }>(
      `SELECT a.addon_key,
              coalesce(array_agg(e.plan_key ORDER BY e.plan_key) FILTER (WHERE e.plan_key IS NOT NULL), '{}') AS eligible_plan_keys
         FROM addon a LEFT JOIN addon_plan_eligibility e USING (addon_key)
        GROUP BY a.addon_key ORDER BY a.addon_key`,
    );
    const addonBundles = await this.#connection.query<BundleRow>(
      "SELECT addon_key AS owner_key, feature_key, quota FROM addon_feature_bundle ORDER BY feature_key",
    );
    const bundlesOf = (rows: readonly BundleRow[], owner: string): readonly Bundle[] =>
      rows
        .filter((row) => row.owner_key === owner)
        .map((row) => ({ featureKey: row.feature_key, quota: row.quota }));
    return {
      features: features.map((row) => ({
        featureKey: row.feature_key,
        productKey: row.product_key,
        meteredUnit: row.metered_unit,
        operations: row.operations,
      })),
      plans: plans.map((row) => ({
        planKey: row.plan_key,
        planLadderKey: row.plan_ladder_key,
        tierRank: row.tier_rank,
        planCategory: row.plan_category,
        bundles: bundlesOf(planBundles, row.plan_key),
      })),
      addons: addons.map((row) => ({
        addonKey: row.addon_key,
        bundles: bundlesOf(addonBundles, row.addon_key),
        eligiblePlanKeys: row.eligible_plan_keys,
      })),
    };
  }
}

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresConnection } from "../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../adapter/tests/support/database.ts";
import { PostgresCatalogRepository } from "../src/infra/postgres-catalog-repository.ts";
import { FindLowestPlanIncluding } from "../src/usecase/find-lowest-plan-including.ts";
import { GetCatalog } from "../src/usecase/get-catalog.ts";

describe("the seeded catalog", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;
  let getCatalog: GetCatalog;

  beforeAll(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
    getCatalog = new GetCatalog({ catalogs: new PostgresCatalogRepository(connection) });
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  test("ensures the seeded catalog loads without a violation, as product §4 states it", async () => {
    const catalog = await getCatalog.execute();
    expect(catalog.plans.map((plan) => [plan.planKey, plan.tierRank, plan.planCategory])).toEqual([
      ["free", 1, "Free"],
      ["pro", 2, "Paid"],
      ["business", 3, "Paid"],
      ["enterprise", 4, "Paid"],
    ]);
    expect(catalog.plans.find((plan) => plan.planKey === "enterprise")?.bundles).toContainEqual({
      featureKey: "seats",
      quota: null,
    });
    expect(catalog.features.find((feature) => feature.featureKey === "sso")).toEqual({
      featureKey: "sso",
      productKey: "workspace",
      meteredUnit: null,
      operations: ["configure"],
    });
    expect(catalog.addons).toEqual([
      {
        addonKey: "advanced-analytics",
        bundles: [{ featureKey: "advanced-analytics", quota: null }],
        eligiblePlanKeys: ["business", "pro"],
      },
    ]);
  });

  test("ensures the remedies of the seeded catalog (PR-10)", async () => {
    const remedies = new FindLowestPlanIncluding({ getCatalog });
    expect(await remedies.execute({ featureKey: "audit-log-export", currentPlanKey: "free" })).toEqual({
      lowestPlanKey: "business",
      addons: [],
    });
    expect(await remedies.execute({ featureKey: "advanced-analytics", currentPlanKey: "free" })).toEqual({
      lowestPlanKey: "enterprise",
      addons: [{ addonKey: "advanced-analytics", eligiblePlanKeys: ["pro", "business"] }],
    });
  });
});

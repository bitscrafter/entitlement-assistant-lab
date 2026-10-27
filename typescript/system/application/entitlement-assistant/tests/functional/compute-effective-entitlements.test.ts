import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import { PostgresCustomerAccountRepository } from "../../../../subsystem/account/src/infra/postgres-customer-account-repository.ts";
import { GetCustomerAccount } from "../../../../subsystem/account/src/usecase/get-customer-account.ts";
import { PostgresSubscriptionRepository } from "../../../../subsystem/entitlement/src/infra/postgres-subscription-repository.ts";
import { ComputeEffectiveEntitlements } from "../../../../subsystem/entitlement/src/usecase/compute-effective-entitlements.ts";
import { PostgresCatalogRepository } from "../../../../subsystem/product/src/infra/postgres-catalog-repository.ts";
import { GetCatalog } from "../../../../subsystem/product/src/usecase/get-catalog.ts";
import { seededUuid } from "../../src/database/seed.ts";

const AT = new Date("2026-10-22T15:00:00Z");

describe("ComputeEffectiveEntitlements over the seeded accounts", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;
  let compute: ComputeEffectiveEntitlements;

  beforeAll(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
    compute = new ComputeEffectiveEntitlements({
      getCustomerAccount: new GetCustomerAccount({
        accounts: new PostgresCustomerAccountRepository(connection),
      }),
      getCatalog: new GetCatalog({ catalogs: new PostgresCatalogRepository(connection) }),
      subscriptions: new PostgresSubscriptionRepository(connection),
    });
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  test("ensures null for an id that is no customer account", async () => {
    expect(await compute.execute({ accountId: seededUuid("acc_massive"), at: AT })).toBeNull();
    expect(await compute.execute({ accountId: seededUuid("iac_alex"), at: AT })).toBeNull();
  });

  test.each([
    ["acc_acme", "Effective", "business"],
    ["acc_hooli", "Effective", "pro"],
    ["acc_globex", "None", "pro"],
    ["acc_stark", "None", "business"],
    ["acc_umbrella", "None", "enterprise"],
    ["acc_tyrell", "None", "enterprise"],
    ["acc_soylent", "None", null],
  ])(
    "ensures %s is computed from its seeded subscription (%s, latest plan %s)",
    async (alias, kind, plan) => {
      const result = await compute.execute({ accountId: seededUuid(alias), at: AT });
      expect(result?.effective.kind).toBe(kind);
      expect(result?.latestPlanKey).toBe(plan);
    },
  );

  test("ensures the seeded Hooli grants: the active one counts, the expired one does not", async () => {
    const result = await compute.execute({ accountId: seededUuid("acc_hooli"), at: AT });
    expect(result?.effective).toMatchObject({
      kind: "Effective",
      entitlements: [
        { featureKey: "api-access", quota: null },
        {
          featureKey: "seats",
          quota: 35,
          sources: [
            { kind: "plan", planKey: "pro" },
            { kind: "grant", grantId: seededUuid("grt_hooli_seats") },
          ],
        },
      ],
    });
  });
});

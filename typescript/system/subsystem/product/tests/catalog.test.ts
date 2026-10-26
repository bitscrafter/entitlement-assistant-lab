import { describe, expect, test } from "vitest";
import { type Catalog, catalogViolations, remedyFor } from "../src/model/catalog.ts";

const metered = (featureKey: string) => ({
  featureKey,
  productKey: "workspace",
  meteredUnit: "seats",
  operations: [],
});
const unmetered = (featureKey: string) => ({
  featureKey,
  productKey: "workspace",
  meteredUnit: null,
  operations: ["use"],
});

const CATALOG: Catalog = {
  features: [metered("seats"), unmetered("api-access"), unmetered("sso"), unmetered("advanced-analytics")],
  plans: [
    {
      planKey: "free",
      planLadderKey: "standard",
      tierRank: 1,
      planCategory: "Free",
      bundles: [{ featureKey: "seats", quota: 3 }],
    },
    {
      planKey: "business",
      planLadderKey: "standard",
      tierRank: 3,
      planCategory: "Paid",
      bundles: [
        { featureKey: "seats", quota: 100 },
        { featureKey: "sso", quota: null },
      ],
    },
    {
      planKey: "pro",
      planLadderKey: "standard",
      tierRank: 2,
      planCategory: "Paid",
      bundles: [{ featureKey: "api-access", quota: null }],
    },
    {
      planKey: "suite",
      planLadderKey: "security",
      tierRank: 1,
      planCategory: "Paid",
      bundles: [{ featureKey: "sso", quota: null }],
    },
  ],
  addons: [
    {
      addonKey: "advanced-analytics",
      bundles: [{ featureKey: "advanced-analytics", quota: null }],
      eligiblePlanKeys: ["business", "pro"],
    },
    { addonKey: "seat-pack", bundles: [{ featureKey: "seats", quota: 10 }], eligiblePlanKeys: ["business"] },
  ],
};

describe("catalogViolations", () => {
  test("ensures a valid catalog has no violation", () => {
    expect(catalogViolations(CATALOG)).toEqual([]);
  });

  test.each([
    [
      "an unknown feature",
      {
        ...CATALOG,
        plans: CATALOG.plans.map((plan) =>
          plan.planKey === "free" ? { ...plan, bundles: [{ featureKey: "fax", quota: null }] } : plan,
        ),
      },
      "plan free includes the unknown feature fax",
    ],
    [
      "a quota on an unmetered feature",
      {
        ...CATALOG,
        plans: CATALOG.plans.map((plan) =>
          plan.planKey === "pro" ? { ...plan, bundles: [{ featureKey: "api-access", quota: 5 }] } : plan,
        ),
      },
      "plan pro sets a quota on the unmetered feature api-access",
    ],
    [
      "an unknown eligible plan",
      { ...CATALOG, addons: [{ ...CATALOG.addons[0], eligiblePlanKeys: ["gold"] }] },
      "add-on advanced-analytics is eligible on the unknown plan gold",
    ],
    [
      "an add-on adding nothing",
      {
        ...CATALOG,
        addons: [
          {
            addonKey: "sso-pack",
            bundles: [{ featureKey: "sso", quota: null }],
            eligiblePlanKeys: ["business"],
          },
        ],
      },
      "add-on sso-pack adds nothing to plan business",
    ],
  ] as const)("ensures %s is a violation", (_name, catalog, violation) => {
    expect(catalogViolations(catalog as Catalog)).toEqual([violation]);
  });

  test("ensures a metered add-on adds something even where the plan includes the feature", () => {
    expect(
      catalogViolations({ ...CATALOG, addons: [CATALOG.addons[1] as Catalog["addons"][number]] }),
    ).toEqual([]);
  });
});

describe("remedyFor", () => {
  test("ensures the lowest plan of the current plan's ladder including the feature", () => {
    expect(remedyFor(CATALOG, "sso", "free").lowestPlanKey).toBe("business");
    expect(remedyFor(CATALOG, "sso", "suite").lowestPlanKey).toBe("suite");
  });

  test("ensures no plan when the ladder has none including the feature, or the account has no plan", () => {
    expect(remedyFor(CATALOG, "advanced-analytics", "free").lowestPlanKey).toBeNull();
    expect(remedyFor(CATALOG, "sso", null).lowestPlanKey).toBeNull();
  });

  test("ensures every add-on including the feature is listed with its plans by rank, unless it can join the current plan", () => {
    expect(remedyFor(CATALOG, "advanced-analytics", "free").addons).toEqual([
      { addonKey: "advanced-analytics", eligiblePlanKeys: ["pro", "business"] },
    ]);
    expect(remedyFor(CATALOG, "advanced-analytics", "pro").addons).toEqual([
      { addonKey: "advanced-analytics", eligiblePlanKeys: [] },
    ]);
    expect(remedyFor(CATALOG, "sso", "free").addons).toEqual([]);
  });
});

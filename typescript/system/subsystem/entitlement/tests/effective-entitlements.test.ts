import { describe, expect, test } from "vitest";
import type { Uuid } from "../../../kernel/identifier.ts";
import {
  type CatalogBundles,
  type EntitlementSnapshot,
  effectiveEntitlements,
  latestPlanKey,
  type Subscription,
  type SubscriptionTerm,
} from "../src/model/effective-entitlements.ts";

const day = (date: string) => new Date(`${date}T00:00:00Z`);
const AT = new Date("2026-10-22T15:00:00Z");
const GRANT = "0199fd00-0000-7000-8000-000000000001" as Uuid;
const OLD_GRANT = "0199fd00-0000-7000-8000-000000000002" as Uuid;

const CATALOG: CatalogBundles = {
  planBundles: new Map([
    ["free", [{ featureKey: "seats", quota: 3 }]],
    [
      "pro",
      [
        { featureKey: "api-access", quota: null },
        { featureKey: "seats", quota: 25 },
      ],
    ],
    [
      "enterprise",
      [
        { featureKey: "seats", quota: null },
        { featureKey: "sso", quota: null },
      ],
    ],
  ]),
  addonBundles: new Map([["advanced-analytics", [{ featureKey: "advanced-analytics", quota: null }]]]),
  meteredFeatures: new Set(["seats"]),
};

const term = (
  planKey: string,
  starts: string,
  ends: string | null,
  overrides: Partial<SubscriptionTerm> = {},
): SubscriptionTerm => ({
  planKey,
  source: "Payment",
  startsAt: day(starts),
  scheduledEndAt: ends === null ? null : day(ends),
  endedAt: null,
  ...overrides,
});

const subscribed = (subscription: Partial<Subscription>): EntitlementSnapshot => ({
  holdReasonCodes: [],
  latestSubscription: {
    startedAt: day("2026-09-01"),
    endedAt: null,
    endReason: null,
    terms: [],
    addons: [],
    grants: [],
    ...subscription,
  },
});

describe("effectiveEntitlements", () => {
  test("ensures a suspended account has none, one reason code per distinct hold, sorted", () => {
    const snapshot = {
      ...subscribed({ terms: [term("pro", "2026-10-01", "2026-11-01")] }),
      holdReasonCodes: [
        "account.operational-suspension",
        "account.customer-removed",
        "account.operational-suspension",
      ],
    };
    expect(effectiveEntitlements(snapshot, CATALOG, AT)).toEqual({
      kind: "None",
      reasonCodes: ["account.customer-removed", "account.operational-suspension"],
      facts: {},
    });
  });

  test.each([
    ["never subscribed", { holdReasonCodes: [], latestSubscription: null }, "entitlement.no-subscription"],
    [
      "the last one canceled",
      subscribed({ endedAt: day("2026-10-05"), endReason: "Canceled" }),
      "entitlement.subscription-canceled",
    ],
    [
      "the last one ended by the customer's removal",
      subscribed({ endedAt: day("2026-10-05"), endReason: "CustomerRemoved" }),
      "entitlement.no-subscription",
    ],
  ] as const)("ensures without a subscription in force, none — %s", (_name, snapshot, reason) => {
    expect(effectiveEntitlements(snapshot as EntitlementSnapshot, CATALOG, AT)).toEqual({
      kind: "None",
      reasonCodes: [reason],
      facts: {},
    });
  });

  test("ensures without a covering term, none, with the last term's source and end as facts", () => {
    const snapshot = subscribed({
      terms: [
        term("free", "2026-08-01", null, { source: "FreePlan", endedAt: day("2026-09-01") }),
        term("pro", "2026-09-01", "2026-10-01"),
      ],
    });
    expect(effectiveEntitlements(snapshot, CATALOG, AT)).toEqual({
      kind: "None",
      reasonCodes: ["entitlement.no-covering-term"],
      facts: { lastTermSource: "Payment", lastTermEndedAt: day("2026-10-01") },
    });
  });

  test("ensures a term ending exactly at the instant no longer covers it, and one cut short stops covering when cut", () => {
    expect(
      effectiveEntitlements(
        subscribed({ terms: [term("pro", "2026-10-01", "2026-10-22")] }),
        CATALOG,
        day("2026-10-22"),
      ).kind,
    ).toBe("None");
    const cut = subscribed({
      terms: [term("pro", "2026-10-01", "2026-11-01", { endedAt: day("2026-10-05") })],
    });
    expect(effectiveEntitlements(cut, CATALOG, AT)).toMatchObject({
      facts: { lastTermEndedAt: day("2026-10-05") },
    });
  });

  test("ensures the plan's bundles, the current add-ons', and the active grants, each feature listing all its sources", () => {
    const snapshot = subscribed({
      terms: [term("pro", "2026-10-15", "2026-11-15")],
      addons: [
        { addonKey: "advanced-analytics", startedAt: day("2026-10-15"), endedAt: null },
        { addonKey: "advanced-analytics", startedAt: day("2026-10-01"), endedAt: day("2026-10-10") },
      ],
      grants: [
        {
          grantId: GRANT,
          featureKey: "seats",
          quota: 10,
          startsAt: day("2026-10-20"),
          expiresAt: day("2026-11-03"),
          endedAt: null,
        },
        {
          grantId: OLD_GRANT,
          featureKey: "seats",
          quota: 5,
          startsAt: day("2026-10-16"),
          expiresAt: day("2026-10-21"),
          endedAt: null,
        },
      ],
    });
    expect(effectiveEntitlements(snapshot, CATALOG, AT)).toEqual({
      kind: "Effective",
      coveringTerm: { source: "Payment", endsAt: day("2026-11-15") },
      entitlements: [
        {
          featureKey: "advanced-analytics",
          quota: null,
          sources: [{ kind: "addon", addonKey: "advanced-analytics" }],
        },
        { featureKey: "api-access", quota: null, sources: [{ kind: "plan", planKey: "pro" }] },
        {
          featureKey: "seats",
          quota: 35,
          sources: [
            { kind: "plan", planKey: "pro" },
            { kind: "grant", grantId: GRANT },
          ],
        },
      ],
    });
  });

  test("ensures a grant is ignored from its expiry, and once ended", () => {
    const grant = {
      grantId: GRANT,
      featureKey: "seats",
      quota: 10,
      startsAt: day("2026-10-20"),
      expiresAt: AT,
      endedAt: null,
    };
    const atExpiry = subscribed({
      terms: [term("free", "2026-09-01", null, { source: "FreePlan" })],
      grants: [grant],
    });
    expect(effectiveEntitlements(atExpiry, CATALOG, AT)).toMatchObject({
      entitlements: [{ featureKey: "seats", quota: 3 }],
    });
    const ended = subscribed({
      terms: [term("free", "2026-09-01", null, { source: "FreePlan" })],
      grants: [{ ...grant, expiresAt: day("2026-11-01"), endedAt: day("2026-10-21") }],
    });
    expect(effectiveEntitlements(ended, CATALOG, AT)).toMatchObject({
      entitlements: [{ featureKey: "seats", quota: 3 }],
    });
  });

  test("ensures a metered quota is unlimited when any source has none, and an unmetered quota is null", () => {
    const snapshot = subscribed({
      terms: [term("enterprise", "2026-01-01", null, { source: "Contract" })],
      grants: [
        {
          grantId: GRANT,
          featureKey: "seats",
          quota: 10,
          startsAt: day("2026-10-20"),
          expiresAt: day("2026-11-03"),
          endedAt: null,
        },
      ],
    });
    expect(effectiveEntitlements(snapshot, CATALOG, AT)).toMatchObject({
      coveringTerm: { source: "Contract", endsAt: null },
      entitlements: [
        { featureKey: "seats", quota: "unlimited" },
        { featureKey: "sso", quota: null },
      ],
    });
  });
});

describe("latestPlanKey", () => {
  test("ensures the plan of the term that started last, current or ended", () => {
    expect(
      latestPlanKey(
        subscribed({
          terms: [
            term("free", "2025-10-01", null, { endedAt: day("2026-01-01") }),
            term("enterprise", "2026-01-01", "2026-10-01"),
          ],
        }),
      ),
    ).toBe("enterprise");
  });

  test("ensures null when the account never had a term", () => {
    expect(latestPlanKey({ holdReasonCodes: [], latestSubscription: null })).toBeNull();
    expect(latestPlanKey(subscribed({}))).toBeNull();
  });
});

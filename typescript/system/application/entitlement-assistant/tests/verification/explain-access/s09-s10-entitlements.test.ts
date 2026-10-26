import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { day, source, specAuditRecords } from "../../support/explain-access.ts";
import { createHarness, type Harness, readRequest, uuidOf } from "../../support/harness.ts";

const GLOBEX_FACTS = { lastTermSource: "Payment", lastTermEndedAt: day("2026-10-01") };

describe("explain-access checking and listing entitlements", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  const check = (account: string, featureKey: string) =>
    harness.application.withUseCases((useCases) =>
      useCases.checkEntitlement.execute({
        ...readRequest("iac_blair"),
        accountId: uuidOf(account),
        featureKey,
      }),
    );
  const list = (account: string) =>
    harness.application.withUseCases((useCases) =>
      useCases.listEntitlements.execute({ ...readRequest("iac_blair"), accountId: uuidOf(account) }),
    );
  const expectOneRead = async (subject: string, useCase: string) => {
    const records = await specAuditRecords(harness);
    expect(
      records.map((record) => [
        record.action_key,
        record.actor,
        record.subject,
        record.audit_outcome,
        record.detail,
      ]),
    ).toEqual([["account.read", "iac_blair", subject, "Allow", { use_case: useCase }]]);
  };

  test.each([
    {
      letter: "A",
      name: "Acme · sso",
      account: "acc_acme",
      feature: "sso",
      expected: {
        sources: ["plan:business"],
        coveringTerm: { source: "Payment", endsAt: day("2026-11-01") },
      },
    },
    {
      letter: "B",
      name: "Acme · advanced-analytics, from an add-on",
      account: "acc_acme",
      feature: "advanced-analytics",
      expected: {
        sources: ["addon:advanced-analytics"],
        coveringTerm: { source: "Payment", endsAt: day("2026-11-01") },
      },
    },
    {
      letter: "C",
      name: "Acme · seats",
      account: "acc_acme",
      feature: "seats",
      expected: {
        quota: 100,
        sources: ["plan:business"],
        coveringTerm: { source: "Payment", endsAt: day("2026-11-01") },
      },
    },
    {
      letter: "D",
      name: "Wayne · api-access, on a trial",
      account: "acc_wayne",
      feature: "api-access",
      expected: { sources: ["plan:pro"], coveringTerm: { source: "Trial", endsAt: day("2026-11-09") } },
    },
    {
      letter: "E",
      name: "Hooli · api-access",
      account: "acc_hooli",
      feature: "api-access",
      expected: { sources: ["plan:pro"], coveringTerm: { source: "Payment", endsAt: day("2026-11-15") } },
    },
    {
      letter: "F",
      name: "Hooli · seats, plan plus an active grant",
      account: "acc_hooli",
      feature: "seats",
      expected: {
        quota: 35,
        sources: ["plan:pro", "grant:grt_hooli_seats"],
        coveringTerm: { source: "Payment", endsAt: day("2026-11-15") },
      },
    },
    {
      letter: "G",
      name: "Jane's own account · api-access",
      account: "acc_jane",
      feature: "api-access",
      expected: { sources: ["plan:pro"], coveringTerm: { source: "Payment", endsAt: day("2026-11-05") } },
    },
    {
      letter: "H",
      name: "Cyberdyne · seats, unlimited",
      account: "acc_cyberdyne",
      feature: "seats",
      expected: {
        quota: "unlimited",
        sources: ["plan:enterprise"],
        coveringTerm: { source: "Contract", endsAt: null },
      },
    },
  ])(
    "scenario 09a ensures a check finds the feature with its sources — case $letter $name",
    async ({ account, feature, expected }) => {
      const result = await check(account, feature);

      expect(result).toMatchObject({ kind: "Entitled", ...expected, sources: expected.sources.map(source) });
      await expectOneRead(account, "CheckEntitlement");
    },
  );

  test.each([
    {
      letter: "A",
      name: "Initech · sso, not in the plan",
      account: "acc_initech",
      feature: "sso",
      reasons: ["entitlement.feature-not-included"],
      facts: {},
    },
    {
      letter: "B",
      name: "Globex · api-access, no covering term",
      account: "acc_globex",
      feature: "api-access",
      reasons: ["entitlement.no-covering-term"],
      facts: GLOBEX_FACTS,
    },
    {
      letter: "C",
      name: "Globex · seats, metered features stop too",
      account: "acc_globex",
      feature: "seats",
      reasons: ["entitlement.no-covering-term"],
      facts: GLOBEX_FACTS,
    },
    {
      letter: "D",
      name: "Stark · sso, subscription canceled",
      account: "acc_stark",
      feature: "sso",
      reasons: ["entitlement.subscription-canceled"],
      facts: {},
    },
    {
      letter: "E",
      name: "Umbrella · seats, account suspended",
      account: "acc_umbrella",
      feature: "seats",
      reasons: ["account.operational-suspension"],
      facts: {},
    },
    {
      letter: "F",
      name: "Soylent · api-access, never subscribed",
      account: "acc_soylent",
      feature: "api-access",
      reasons: ["entitlement.no-subscription"],
      facts: {},
    },
  ])(
    "scenario 09b ensures a check explains why the feature is missing — case $letter $name",
    async ({ account, feature, reasons, facts }) => {
      const result = await check(account, feature);

      expect(result).toMatchObject({ kind: "NotEntitled", reasonCodes: reasons, facts });
      await expectOneRead(account, "CheckEntitlement");
    },
  );

  const entry = (featureKey: string, quota: number | "unlimited" | null, ...sources: string[]) => ({
    featureKey,
    quota,
    sources: sources.map(source),
  });

  test.each([
    {
      letter: "A",
      name: "Acme",
      account: "acc_acme",
      entries: [
        entry("advanced-analytics", null, "addon:advanced-analytics"),
        entry("api-access", null, "plan:business"),
        entry("audit-log-export", null, "plan:business"),
        entry("seats", 100, "plan:business"),
        entry("sso", null, "plan:business"),
      ],
    },
    { letter: "B", name: "Initech", account: "acc_initech", entries: [entry("seats", 3, "plan:free")] },
    {
      letter: "C",
      name: "Hooli, with a grant",
      account: "acc_hooli",
      entries: [
        entry("api-access", null, "plan:pro"),
        entry("seats", 35, "plan:pro", "grant:grt_hooli_seats"),
      ],
    },
    {
      letter: "D",
      name: "Cyberdyne, unlimited seats",
      account: "acc_cyberdyne",
      entries: [
        entry("advanced-analytics", null, "plan:enterprise"),
        entry("api-access", null, "plan:enterprise"),
        entry("audit-log-export", null, "plan:enterprise"),
        entry("seats", "unlimited", "plan:enterprise"),
        entry("sso", null, "plan:enterprise"),
      ],
    },
  ])(
    "scenario 10a ensures a list shows every effective entitlement with its sources — case $letter $name",
    async ({ account, entries }) => {
      const result = await list(account);

      expect(result).toMatchObject({ kind: "Listed", entries });
      expect(result.kind === "Listed" ? result.entries : null).toEqual(entries);
      await expectOneRead(account, "ListEntitlements");
    },
  );

  test.each([
    {
      letter: "A",
      name: "Globex, no covering term",
      account: "acc_globex",
      reasons: ["entitlement.no-covering-term"],
      facts: GLOBEX_FACTS,
    },
    {
      letter: "B",
      name: "Umbrella, suspended",
      account: "acc_umbrella",
      reasons: ["account.operational-suspension"],
      facts: {},
    },
    {
      letter: "C",
      name: "Soylent, never subscribed",
      account: "acc_soylent",
      reasons: ["entitlement.no-subscription"],
      facts: {},
    },
  ])(
    "scenario 10b ensures a list with nothing effective says why — case $letter $name",
    async ({ account, reasons, facts }) => {
      const result = await list(account);

      expect(result).toMatchObject({ kind: "Listed", entries: [], reasonCodes: reasons, facts });
      await expectOneRead(account, "ListEntitlements");
    },
  );
});

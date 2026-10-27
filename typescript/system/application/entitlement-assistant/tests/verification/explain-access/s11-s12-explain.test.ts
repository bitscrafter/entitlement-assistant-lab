import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { day, source, specAuditRecords } from "../../support/explain-access.ts";
import { createHarness, type Harness, readRequest, uuidOf } from "../../support/harness.ts";

describe("explain-access explaining a person's access", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  const explain = (personEmail: string, account: string, featureKey: string, operation: string) =>
    harness.application.withUseCases((useCases) =>
      useCases.explainAccess.execute({
        ...readRequest("iac_blair"),
        personEmail,
        accountId: uuidOf(account),
        featureKey,
        operation,
      }),
    );
  const expectOneRead = async (subject: string) => {
    const records = await specAuditRecords(harness);
    expect(
      records.map((record) => [
        record.action_key,
        record.actor,
        record.subject,
        record.audit_outcome,
        record.detail,
      ]),
    ).toEqual([["account.read", "iac_blair", subject, "Allow", { use_case: "ExplainAccess" }]]);
  };
  const access = (...roles: string[]) => ({ kind: "access", grantedByRoles: roles });
  const entitlement = (written: string, coveringTermSource: string) => ({
    kind: "entitlement",
    sources: [source(written)],
    coveringTermSource,
  });

  test.each([
    {
      letter: "A",
      name: "Jane · Acme · sso",
      person: "jane@acme.com",
      account: "acc_acme",
      feature: "sso",
      operation: "configure",
      findings: [access("admin"), entitlement("plan:business", "Payment")],
    },
    {
      letter: "B",
      name: "Ben · Acme · audit-log-export",
      person: "ben@acme.com",
      account: "acc_acme",
      feature: "audit-log-export",
      operation: "export",
      findings: [access("billing"), entitlement("plan:business", "Payment")],
    },
    {
      letter: "C",
      name: "Carol · Acme · advanced-analytics",
      person: "carol@acme.com",
      account: "acc_acme",
      feature: "advanced-analytics",
      operation: "view",
      findings: [access("viewer"), entitlement("addon:advanced-analytics", "Payment")],
    },
    {
      letter: "D",
      name: "Gavin · Hooli · api-access",
      person: "gavin@hooli.com",
      account: "acc_hooli",
      feature: "api-access",
      operation: "create-token",
      findings: [access("owner"), entitlement("plan:pro", "Payment")],
    },
    {
      letter: "E",
      name: "Bruce · Wayne · api-access",
      person: "bruce@wayne.com",
      account: "acc_wayne",
      feature: "api-access",
      operation: "create-token",
      findings: [access("owner"), entitlement("plan:pro", "Trial")],
    },
    {
      letter: "F",
      name: "Jane · Jane's own account · api-access",
      person: "jane@acme.com",
      account: "acc_jane",
      feature: "api-access",
      operation: "create-token",
      findings: [access("owner"), entitlement("plan:pro", "Payment")],
    },
  ])(
    "scenario 11 ensures an explanation says why a person can use a feature in an account — case $letter $name",
    async ({ person, account, feature, operation, findings }) => {
      const result = await explain(person, account, feature, operation);

      expect(result).toMatchObject({ kind: "Explained", outcome: "Allow", findings, reasonCodes: [] });
      await expectOneRead(account);
    },
  );

  test.each([
    {
      letter: "A",
      name: "Pat · Umbrella · sso, the subject is suspended",
      person: "pat@umbrella.com",
      account: "acc_umbrella",
      feature: "sso",
      operation: "configure",
      expected: { reasonCodes: ["account.operational-suspension"] },
    },
    {
      letter: "B",
      name: "Lee · Globex · api-access, no covering term",
      person: "lee@globex.com",
      account: "acc_globex",
      feature: "api-access",
      operation: "create-token",
      expected: {
        reasonCodes: ["entitlement.no-covering-term"],
        facts: { lastTermSource: "Payment", lastTermEndedAt: day("2026-10-01") },
      },
    },
    {
      letter: "C",
      name: "Tony · Stark · sso, subscription canceled",
      person: "tony@stark.com",
      account: "acc_stark",
      feature: "sso",
      operation: "configure",
      expected: { reasonCodes: ["entitlement.subscription-canceled"] },
    },
    {
      letter: "D",
      name: "Bob · Initech · audit-log-export, not in the plan",
      person: "bob@initech.com",
      account: "acc_initech",
      feature: "audit-log-export",
      operation: "export",
      expected: {
        reasonCodes: ["entitlement.feature-not-included"],
        remedy: { lowestPlanKey: "business", addons: [] },
      },
    },
    {
      letter: "E",
      name: "Bob · Initech · advanced-analytics, not in the plan",
      person: "bob@initech.com",
      account: "acc_initech",
      feature: "advanced-analytics",
      operation: "view",
      expected: {
        reasonCodes: ["entitlement.feature-not-included"],
        remedy: {
          lowestPlanKey: "enterprise",
          addons: [{ addonKey: "advanced-analytics", eligiblePlanKeys: ["pro", "business"] }],
        },
      },
    },
    {
      letter: "F",
      name: "Dan · Acme · sso, the person's account is suspended",
      person: "dan@acme.com",
      account: "acc_acme",
      feature: "sso",
      operation: "configure",
      expected: { reasonCodes: ["account.no-active-membership"] },
    },
    {
      letter: "G",
      name: "Carol · Acme · api-access, the role does not give it",
      person: "carol@acme.com",
      account: "acc_acme",
      feature: "api-access",
      operation: "create-token",
      expected: { reasonCodes: ["access.permission-not-held"] },
    },
    {
      letter: "H",
      name: "Jane · Initech · sso, two reasons",
      person: "jane@acme.com",
      account: "acc_initech",
      feature: "sso",
      operation: "configure",
      expected: {
        reasonCodes: ["access.permission-not-held", "entitlement.feature-not-included"],
        remedy: { lowestPlanKey: "business", addons: [] },
      },
    },
  ])(
    "scenario 12 ensures an explanation says why a person cannot, with every reason and a remedy — case $letter $name",
    async ({ person, account, feature, operation, expected }) => {
      const result = await explain(person, account, feature, operation);

      expect(result).toMatchObject({ kind: "Explained", outcome: "Deny", ...expected });
      expect(result.kind === "Explained" ? [...result.reasonCodes].sort() : null).toEqual(
        [...expected.reasonCodes].sort(),
      );
      await expectOneRead(account);
    },
  );
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type SpecAuditRecord, specAuditRecords } from "../../support/explain-access.ts";
import { createHarness, external, type Harness, readRequest, uuidOf } from "../../support/harness.ts";

const LOOKUP = { action_key: "account.read", case: null } as const;

/** Every S07 record carries the action key, the use case, and the policy set version; order is not specified. */
function lookupRecords(records: readonly SpecAuditRecord[]) {
  for (const record of records) {
    expect(record.action_key).toBe("account.read");
    expect(record.detail.use_case).toBe("FindCustomerAccount");
    expect(record.policy_set_version).not.toBeNull();
  }
  return records
    .map((record) => ({
      actor: record.actor,
      subject: record.subject,
      audit_outcome: record.audit_outcome,
      reasons: record.reasons,
    }))
    .sort((left, right) => String(left.subject).localeCompare(String(right.subject)));
}

describe("explain-access finding an account", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  const find = (principal: string, query: string) =>
    harness.application.withUseCases((useCases) =>
      useCases.findCustomerAccount.execute({ ...readRequest(principal), query }),
    );

  test.each([
    { letter: "A", name: "by account id", query: external("acc_initech") },
    { letter: "B", name: "by name, case-insensitive", query: "initech" },
  ])("scenario 07a ensures an account is found by id or by name — case $letter $name", async ({ query }) => {
    const result = await find("iac_blair", query);

    expect(result).toEqual({
      kind: "Found",
      account: {
        accountId: uuidOf("acc_initech"),
        displayName: "Initech",
        accountCategory: "Standalone",
        holds: [],
        planKey: "free",
        coveringTerm: { source: "FreePlan", endsAt: null },
        addonKeys: [],
        ownersAndAdmins: ["bob@initech.com"],
      },
    });
    const records = await specAuditRecords(harness);
    expect(records.map(({ policy_set_version: _version, ...record }) => record)).toEqual([
      {
        ...LOOKUP,
        actor: "iac_blair",
        subject: "acc_initech",
        audit_outcome: "Allow",
        reasons: [],
        detail: { use_case: "FindCustomerAccount" },
      },
    ]);
    expect(records[0]?.policy_set_version).not.toBeNull();
  });

  test.each([
    {
      letter: "A",
      name: "by email, a member",
      query: "bob@initech.com",
      candidates: [
        { accountId: uuidOf("acc_bob"), ownAccount: true, roles: ["owner"] },
        { accountId: uuidOf("acc_initech"), ownAccount: false, roles: ["owner"] },
      ],
      subjects: ["acc_bob", "acc_initech"],
    },
    {
      letter: "B",
      name: "by email, a member who also has a personal subscription",
      query: "jane@acme.com",
      candidates: [
        { accountId: uuidOf("acc_jane"), ownAccount: true, roles: ["owner"] },
        { accountId: uuidOf("acc_acme"), ownAccount: false, roles: ["admin", "billing"] },
      ],
      subjects: ["acc_acme", "acc_jane"],
    },
    {
      letter: "C",
      name: "by an ambiguous name",
      query: "acme",
      candidates: [
        { accountId: uuidOf("acc_acme"), displayName: "Acme Corp" },
        { accountId: uuidOf("acc_acme_labs"), displayName: "Acme Labs" },
      ],
      subjects: ["acc_acme", "acc_acme_labs"],
    },
  ])(
    "scenario 07b ensures a query matching several accounts lists every authorized candidate — case $letter $name",
    async ({ query, candidates, subjects }) => {
      const result = await find("iac_blair", query);

      expect(result.kind).toBe("Ambiguous");
      expect(result.kind === "Ambiguous" ? result.candidates : []).toEqual(
        candidates.map((candidate) => expect.objectContaining(candidate)),
      );
      expect(lookupRecords(await specAuditRecords(harness))).toEqual(
        subjects.map((subject) => ({ actor: "iac_blair", subject, audit_outcome: "Allow", reasons: [] })),
      );
    },
  );

  test("scenario 07c ensures a candidate denied by a policy is left out", async () => {
    const result = await find("iac_alex", "pat@umbrella.com");

    expect(result.kind).toBe("Found");
    expect(result.kind === "Found" ? result.account.accountId : null).toBe(uuidOf("acc_pat"));
    expect(lookupRecords(await specAuditRecords(harness))).toEqual([
      { actor: "iac_alex", subject: "acc_pat", audit_outcome: "Allow", reasons: [] },
      {
        actor: "iac_alex",
        subject: "acc_umbrella",
        audit_outcome: "Deny",
        reasons: ["policy.enterprise-accounts-need-level-2"],
      },
    ]);
  });

  test.each([
    {
      letter: "A",
      name: "a principal without account.read",
      principal: "iac_drew",
      query: "initech",
      record: {
        actor: "iac_drew",
        subject: null,
        audit_outcome: "Deny",
        reasons: ["access.permission-not-held"],
      },
    },
    {
      letter: "B",
      name: "nothing matches",
      principal: "iac_blair",
      query: "Massive Dynamic",
      record: {
        actor: "iac_blair",
        subject: null,
        audit_outcome: "Failed",
        reasons: ["support.no-matching-account"],
      },
    },
  ])(
    "scenario 07d ensures no match, and no authorized match, look the same — case $letter $name",
    async ({ principal, query, record }) => {
      const result = await find(principal, query);

      expect(result).toEqual({ kind: "NotFound" });
      const records = await specAuditRecords(harness);
      expect(lookupRecords(records)).toEqual([record]);
      expect(Object.keys(records[0]?.detail ?? {}).sort()).toEqual(["query_hmac", "use_case"]);
      expect(JSON.stringify(records)).not.toContain(query);
    },
  );
});

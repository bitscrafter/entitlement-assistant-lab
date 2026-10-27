import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { specAuditRecords } from "../../support/explain-access.ts";
import { createHarness, external, type Harness, readRequest, uuidOf } from "../../support/harness.ts";

const POLICY = "policy.enterprise-accounts-need-level-2";

describe("explain-access reading Enterprise accounts", () => {
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
  const records = async () =>
    (await specAuditRecords(harness)).map(
      ({ policy_set_version: _version, case: _case, ...record }) => record,
    );

  test.each([
    { letter: "A", name: "a current Enterprise account", account: "acc_umbrella" },
    { letter: "B", name: "a lapsed Enterprise account", account: "acc_tyrell" },
  ])(
    "scenario 08a requires level 2 or a supervisor to read an Enterprise account — case $letter $name",
    async ({ account }) => {
      expect(await find("iac_alex", external(account))).toEqual({ kind: "Denied", reasonCodes: [POLICY] });
      expect(await records()).toEqual([
        {
          action_key: "account.read",
          actor: "iac_alex",
          subject: account,
          audit_outcome: "Deny",
          detail: { use_case: "FindCustomerAccount" },
          reasons: [POLICY],
        },
      ]);
    },
  );

  test.each([
    { letter: "A", name: "representative, level 2", principal: "iac_blair" },
    { letter: "B", name: "supervisor", principal: "iac_sam" },
  ])(
    "scenario 08b ensures level 2 and supervisors may read an Enterprise account — case $letter $name",
    async ({ principal }) => {
      const result = await find(principal, external("acc_umbrella"));

      expect(result.kind).toBe("Found");
      expect(result.kind === "Found" ? [result.account.accountId, result.account.holds] : null).toEqual([
        uuidOf("acc_umbrella"),
        ["account.operational-suspension"],
      ]);
      expect(await records()).toEqual([
        {
          action_key: "account.read",
          actor: principal,
          subject: "acc_umbrella",
          audit_outcome: "Allow",
          detail: { use_case: "FindCustomerAccount" },
          reasons: [],
        },
      ]);
    },
  );

  test.each([
    {
      letter: "A",
      name: "a principal without account.read",
      principal: "iac_drew",
      query: external("acc_umbrella"),
      record: {
        action_key: "account.read",
        actor: "iac_drew",
        subject: null,
        audit_outcome: "Deny",
        reasons: ["access.permission-not-held"],
      },
      detailKeys: ["query_hmac", "use_case"],
    },
    {
      letter: "B",
      name: "an account that does not exist",
      principal: "iac_blair",
      query: external("acc_massive"),
      record: {
        action_key: "account.read",
        actor: "iac_blair",
        subject: null,
        audit_outcome: "Failed",
        reasons: ["support.no-matching-account"],
      },
      detailKeys: ["query_hmac", "use_case"],
    },
  ])(
    "scenario 08c ensures without account.read an Enterprise account looks like a missing one — case $letter $name",
    async ({ principal, query, record, detailKeys }) => {
      expect(await find(principal, query)).toEqual({ kind: "NotFound" });
      const written = await records();
      expect(written.map(({ detail: _detail, ...rest }) => rest)).toEqual([record]);
      expect(Object.keys(written[0]?.detail ?? {}).sort()).toEqual(detailKeys);
      expect(written[0]?.detail.use_case).toBe("FindCustomerAccount");
    },
  );

  test.each([
    {
      letter: "A",
      name: "a check",
      useCase: "CheckEntitlement",
      run: (harness: Harness) =>
        harness.application.withUseCases((useCases) =>
          useCases.checkEntitlement.execute({
            ...readRequest("iac_alex"),
            accountId: uuidOf("acc_umbrella"),
            featureKey: "seats",
          }),
        ),
    },
    {
      letter: "B",
      name: "a list",
      useCase: "ListEntitlements",
      run: (harness: Harness) =>
        harness.application.withUseCases((useCases) =>
          useCases.listEntitlements.execute({
            ...readRequest("iac_alex"),
            accountId: uuidOf("acc_umbrella"),
          }),
        ),
    },
    {
      letter: "C",
      name: "an explanation",
      useCase: "ExplainAccess",
      run: (harness: Harness) =>
        harness.application.withUseCases((useCases) =>
          useCases.explainAccess.execute({
            ...readRequest("iac_alex"),
            personEmail: "pat@umbrella.com",
            accountId: uuidOf("acc_umbrella"),
            featureKey: "sso",
            operation: "configure",
          }),
        ),
    },
  ])(
    "scenario 08d ensures checks, lists, and explanations include the same account.read finding — case $letter $name",
    async ({ useCase, run }) => {
      expect(await run(harness)).toEqual({ kind: "Denied", reasonCodes: [POLICY] });
      expect(await records()).toEqual([
        {
          action_key: "account.read",
          actor: "iac_alex",
          subject: "acc_umbrella",
          audit_outcome: "Deny",
          detail: { use_case: useCase },
          reasons: [POLICY],
        },
      ]);
    },
  );

  test.each([
    {
      letter: "A",
      name: "a check without account.read",
      run: (harness: Harness, principal: string, account: string) =>
        harness.application.withUseCases((useCases) =>
          useCases.checkEntitlement.execute({
            ...readRequest(principal),
            accountId: uuidOf(account),
            featureKey: "sso",
          }),
        ),
      principal: "iac_drew",
      account: "acc_initech",
      record: { useCase: "CheckEntitlement", reasons: ["access.permission-not-held"] },
    },
    {
      letter: "B",
      name: "a list of an Enterprise account without account.read",
      run: (harness: Harness, principal: string, account: string) =>
        harness.application.withUseCases((useCases) =>
          useCases.listEntitlements.execute({ ...readRequest(principal), accountId: uuidOf(account) }),
        ),
      principal: "iac_drew",
      account: "acc_umbrella",
      record: { useCase: "ListEntitlements", reasons: ["access.permission-not-held"] },
    },
    {
      letter: "C",
      name: "a check of an account that does not exist",
      run: (harness: Harness, principal: string, account: string) =>
        harness.application.withUseCases((useCases) =>
          useCases.checkEntitlement.execute({
            ...readRequest(principal),
            accountId: uuidOf(account),
            featureKey: "sso",
          }),
        ),
      principal: "iac_blair",
      account: "acc_massive",
      record: null,
    },
  ])(
    "scenario 08e ensures checks and lists without account.read look like a missing account — case $letter $name",
    async ({ run, principal, account, record }) => {
      expect(await run(harness, principal, account)).toEqual({ kind: "NotFound" });
      expect(await records()).toEqual(
        record === null
          ? []
          : [
              {
                action_key: "account.read",
                actor: principal,
                subject: account,
                audit_outcome: "Deny",
                detail: { use_case: record.useCase },
                reasons: record.reasons,
              },
            ],
      );
    },
  );
});

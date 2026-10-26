import { describe, expect, test } from "vitest";
import { FixedClock } from "../../../adapter/clock/fixed-clock.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import type { AuditEntry, AuditRecorder } from "../../../port/audit-recorder.ts";
import type { AuthorizationDecider, Decision } from "../../../port/authorization-decider.ts";
import type { IdentifierHasher } from "../../../port/identifier-hasher.ts";
import type { ListAccountRoles } from "../../access/src/usecase/list-account-roles.ts";
import type { CustomerAccountRepository } from "../../account/src/usecase/customer-account-repository.ts";
import { GetCustomerAccount } from "../../account/src/usecase/get-customer-account.ts";
import type { FindIndividualByEmail } from "../../customer-identity/src/usecase/find-individual-by-email.ts";
import type { GetIndividuals } from "../../customer-identity/src/usecase/get-individuals.ts";
import type { ComputeEffectiveEntitlements } from "../../entitlement/src/usecase/compute-effective-entitlements.ts";
import { CheckEntitlement } from "../src/usecase/check-entitlement.ts";
import { FindCustomerAccount } from "../src/usecase/find-customer-account.ts";
import { ReadEnforcement } from "../src/usecase/read-enforcement.ts";

const DREW = "0199a1b2-0000-7000-8000-00000000d3e1" as Uuid;
const UMBRELLA = "0199a1b2-0000-7000-8000-0000000000aa" as Uuid;
const touched: string[] = [];

/** A double of every customer-data port and use case that records any call, so the test sees whether data was read. */
const untouchable = <Type extends object>(name: string): Type =>
  new Proxy({} as Type, {
    get: (_target, property) => () => {
      touched.push(`${name}.${String(property)}`);
      throw new Error(`${name}.${String(property)} was called on the refused path`);
    },
  });

const refusingDecider: AuthorizationDecider = {
  decide: async () => {
    touched.push("decider.decide");
    throw new Error("a full decision was requested on the refused path");
  },
  decidePermission: async (): Promise<Decision> => ({
    outcome: "Deny",
    findings: [
      { source: "access", outcome: "Deny", reasonCodes: ["access.permission-not-held"], grantedByRoles: [] },
    ],
    reasonCodes: ["access.permission-not-held"],
    policySetVersion: "v".repeat(43),
  }),
};

function readers() {
  touched.length = 0;
  const records: AuditEntry[] = [];
  const audit: AuditRecorder = { record: async (entry) => void records.push(entry) };
  const getCustomerAccount = new GetCustomerAccount({
    accounts: untouchable<CustomerAccountRepository>("customerAccounts"),
  });
  const enforcement = new ReadEnforcement({ decider: refusingDecider, audit, getCustomerAccount });
  const computeEffectiveEntitlements = untouchable<ComputeEffectiveEntitlements>(
    "computeEffectiveEntitlements",
  );
  const clock = new FixedClock(new Date("2026-10-22T15:00:00Z"));
  const hasher: IdentifierHasher = { hash: async () => "h".repeat(22) };
  return {
    records,
    check: new CheckEntitlement({ enforcement, computeEffectiveEntitlements, clock }),
    find: new FindCustomerAccount({
      enforcement,
      identifierHasher: hasher,
      findIndividualByEmail: untouchable<FindIndividualByEmail>("findIndividualByEmail"),
      getIndividuals: untouchable<GetIndividuals>("getIndividuals"),
      getCustomerAccount,
      listAccountRoles: untouchable<ListAccountRoles>("listAccountRoles"),
      computeEffectiveEntitlements,
      clock,
    }),
  };
}

const request = {
  principalAccountId: DREW,
  sessionId: null,
  caseId: null,
  toolCallId: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
};

describe("the permission gate (explain-access D12)", () => {
  test.each(["Umbrella", "pat@umbrella.com", "acc_x"])(
    "invariant a lookup by a principal without account.read reads no customer data (query %s)",
    async (query) => {
      const { find, records } = readers();
      expect(await find.execute({ ...request, query })).toEqual({ kind: "NotFound" });
      expect(touched).toEqual([]);
      expect(
        records.map((record) => [record.outcome, record.subjectAccountId, record.reasons, record.detail]),
      ).toEqual([
        [
          "Deny",
          null,
          ["access.permission-not-held"],
          { use_case: "FindCustomerAccount", query_hmac: "h".repeat(22) },
        ],
      ]);
    },
  );

  test("invariant a check by a principal without account.read reads no customer data", async () => {
    const { check, records } = readers();
    expect(await check.execute({ ...request, accountId: UMBRELLA, featureKey: "sso" })).toEqual({
      kind: "NotFound",
    });
    expect(touched).toEqual([]);
    expect(records.map((record) => [record.outcome, record.subjectAccountId, record.reasons])).toEqual([
      ["Deny", UMBRELLA, ["access.permission-not-held"]],
    ]);
  });
});

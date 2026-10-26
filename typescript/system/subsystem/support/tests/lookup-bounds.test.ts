import { describe, expect, test } from "vitest";
import { FixedClock } from "../../../adapter/clock/fixed-clock.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import type { AuditRecorder } from "../../../port/audit-recorder.ts";
import type { AuthorizationDecider, Decision } from "../../../port/authorization-decider.ts";
import type { ListAccountRoles } from "../../access/src/usecase/list-account-roles.ts";
import type {
  CustomerAccount,
  CustomerAccountRepository,
} from "../../account/src/usecase/customer-account-repository.ts";
import { GetCustomerAccount } from "../../account/src/usecase/get-customer-account.ts";
import type { FindIndividualByEmail } from "../../customer-identity/src/usecase/find-individual-by-email.ts";
import type { GetIndividuals } from "../../customer-identity/src/usecase/get-individuals.ts";
import type { ComputeEffectiveEntitlements } from "../../entitlement/src/usecase/compute-effective-entitlements.ts";
import { FindCustomerAccount, MAXIMUM_DECIDED } from "../src/usecase/find-customer-account.ts";
import { ReadEnforcement } from "../src/usecase/read-enforcement.ts";

const BLAIR = "0199a1b2-0000-7000-8000-0000000b1a1e" as Uuid;
const accountIdOf = (number: number) => `0199a1b2-0000-7000-8000-${String(number).padStart(12, "0")}` as Uuid;
const OWN = accountIdOf(0);

const allow: Decision = { outcome: "Allow", findings: [], reasonCodes: [], policySetVersion: "v".repeat(43) };
const allowingDecider: AuthorizationDecider = {
  decide: async () => allow,
  decidePermission: async () => allow,
};

/** A person who owns one account and holds a role in `roleAccounts` others; counts every account read. */
function lookupOfPersonWithRoles(roleAccounts: number) {
  const reads: Uuid[] = [];
  const accountOf = (accountId: Uuid): CustomerAccount => ({
    accountId,
    displayName: `Account ${accountId.slice(-3)}`,
    accountCategory: "Standalone",
    customerId: accountId,
    customerKind: "Organization",
    holds: [],
  });
  const accounts: CustomerAccountRepository = {
    findById: async (accountId) => {
      reads.push(accountId);
      return accountOf(accountId);
    },
    findByCustomer: async () => accountOf(OWN),
    searchByDisplayName: async () => [],
  };
  const getCustomerAccount = new GetCustomerAccount({ accounts });
  const audit: AuditRecorder = { record: async () => undefined };
  const assignments = Array.from({ length: roleAccounts }, (_, index) => ({
    memberAccountId: OWN,
    memberOfAccountId: accountIdOf(index + 1),
    roleKey: "admin",
  }));
  const find = new FindCustomerAccount({
    enforcement: new ReadEnforcement({ decider: allowingDecider, audit, getCustomerAccount }),
    identifierHasher: { hash: async () => "h".repeat(22) },
    findIndividualByEmail: { execute: async () => ({ customerId: OWN }) } as unknown as FindIndividualByEmail,
    getIndividuals: { execute: async () => [] } as unknown as GetIndividuals,
    getCustomerAccount,
    listAccountRoles: { execute: async () => assignments } as unknown as ListAccountRoles,
    computeEffectiveEntitlements: {} as ComputeEffectiveEntitlements,
    clock: new FixedClock(new Date("2026-10-22T15:00:00Z")),
  });
  return { find, reads };
}

describe("a lookup by email is bounded (explain-access D14)", () => {
  test("ensures at most MAXIMUM_DECIDED - 1 accounts where the person holds a role are read", async () => {
    const { find, reads } = lookupOfPersonWithRoles(60);

    const result = await find.execute({
      principalAccountId: BLAIR,
      sessionId: null,
      caseId: null,
      toolCallId: null,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      query: "pat@umbrella.com",
    });

    expect(reads).toHaveLength(MAXIMUM_DECIDED - 1);
    expect(result).toMatchObject({ kind: "Ambiguous", moreMatches: true });
  });
});

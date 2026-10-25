import { describe, expect, test } from "vitest";
import { principalRefusalReasons } from "../src/model/principal.ts";

describe("principalRefusalReasons", () => {
  test("ensures no reason for an active identity without holds", () => {
    expect(principalRefusalReasons([], true)).toEqual([]);
  });

  test.each([
    ["OperationalSuspension", "account.operational-suspension"],
    ["CustomerRemoved", "account.customer-removed"],
    ["NoActiveMembership", "account.no-active-membership"],
    ["InternalIdentityInactive", "account.internal-identity-inactive"],
  ] as const)("ensures hold %s gives reason %s", (hold, reason) => {
    expect(principalRefusalReasons([hold], true)).toEqual([reason]);
  });

  test("ensures an inactive identity is a reason even without a hold", () => {
    expect(principalRefusalReasons([], false)).toEqual(["account.internal-identity-inactive"]);
  });

  test("ensures reasons are unique and sorted", () => {
    expect(
      principalRefusalReasons(
        ["OperationalSuspension", "InternalIdentityInactive", "OperationalSuspension"],
        false,
      ),
    ).toEqual(["account.internal-identity-inactive", "account.operational-suspension"]);
  });
});

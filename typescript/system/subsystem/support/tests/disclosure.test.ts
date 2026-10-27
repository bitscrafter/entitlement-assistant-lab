import { describe, expect, test } from "vitest";
import { disclose } from "../src/model/disclosure.ts";

describe("disclose", () => {
  test("ensures Allowed exactly for an Allow decision", () => {
    expect(disclose({ outcome: "Allow", reasonCodes: [] }, true)).toEqual({ kind: "Allowed" });
    expect(disclose({ outcome: "Allow", reasonCodes: [] }, false)).toEqual({ kind: "Allowed" });
  });

  test("ensures Denied with the reasons for a holder of account.read stopped by policies alone", () => {
    const reasons = ["policy.enterprise-accounts-need-level-2"];
    expect(disclose({ outcome: "Deny", reasonCodes: reasons }, true)).toEqual({
      kind: "Denied",
      reasonCodes: reasons,
    });
  });

  test.each([
    [
      "a principal without account.read",
      { outcome: "Deny", reasonCodes: ["policy.enterprise-accounts-need-level-2"] },
      false,
    ],
    [
      "a refusal that is not a policy's",
      { outcome: "Deny", reasonCodes: ["access.permission-not-held"] },
      true,
    ],
    [
      "a policy refusal mixed with another",
      { outcome: "Deny", reasonCodes: ["account.operational-suspension", "policy.x"] },
      true,
    ],
    ["a refusal without reasons", { outcome: "Deny", reasonCodes: [] }, true],
  ] as const)("ensures NotFound for %s", (_name, decision, holdsRead) => {
    expect(disclose(decision, holdsRead)).toEqual({ kind: "NotFound" });
  });
});

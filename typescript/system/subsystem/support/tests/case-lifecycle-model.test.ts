import { describe, expect, test } from "vitest";
import type { Decision } from "../../../port/authorization-decider.ts";
import { authenticationExpiresAt, checkAuthenticationMethod } from "../src/model/contact-authentication.ts";
import { combineDecisions } from "../src/usecase/combined-decision.ts";

describe("checkAuthenticationMethod (case-lifecycle D4)", () => {
  test.each([
    ["Knowledge", "SecurityQuestion"],
    ["Knowledge", "AccountDetails"],
  ])("ensures %s · %s is accepted", (kind, method) => {
    expect(checkAuthenticationMethod(kind, method)).toEqual({
      kind: "Accepted",
      authenticationKind: kind,
      method,
    });
  });

  test.each([
    ["Possession", "OneTimeCode"],
    ["Knowledge", "SupportPasscode"],
    ["Knowledge", "Password"],
    ["Knowledge", "constructor"],
  ])("ensures %s · %s is not accepted", (kind, method) => {
    expect(checkAuthenticationMethod(kind, method)).toEqual({ kind: "NotAccepted" });
  });

  test.each([
    ["Knowledge", "OneTimeCode"],
    ["Possession", "SecurityQuestion"],
  ])("ensures %s · %s is not of its kind", (kind, method) => {
    expect(checkAuthenticationMethod(kind, method)).toEqual({ kind: "NotOfKind" });
  });

  test("ensures an authentication counts for 30 minutes (D5)", () => {
    expect(authenticationExpiresAt(new Date("2026-10-22T14:50:00Z"))).toEqual(
      new Date("2026-10-22T15:20:00Z"),
    );
  });
});

describe("combineDecisions (AU-4, case-lifecycle Q1)", () => {
  const decision = (outcome: Decision["outcome"], reasonCodes: string[]): Decision => ({
    outcome,
    findings: [{ source: "access", outcome, reasonCodes, grantedByRoles: [] }],
    reasonCodes,
    policySetVersion: "v1",
  });

  test("ensures the most restrictive outcome, every finding, and unique sorted reasons", () => {
    const combined = combineDecisions(
      decision("Allow", []),
      decision("Deny", ["policy.b", "access.a"]),
      decision("Conditional", ["policy.b"]),
    );
    expect(combined.outcome).toBe("Deny");
    expect(combined.findings).toHaveLength(3);
    expect(combined.reasonCodes).toEqual(["access.a", "policy.b"]);
    expect(combined.policySetVersion).toBe("v1");
  });

  test("ensures Conditional outranks Allow", () => {
    expect(combineDecisions(decision("Allow", []), decision("Conditional", ["policy.c"])).outcome).toBe(
      "Conditional",
    );
  });
});

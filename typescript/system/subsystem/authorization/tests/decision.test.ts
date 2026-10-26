import { describe, expect, test } from "vitest";
import type { Finding } from "../../../port/authorization-decider.ts";
import { combineFindings } from "../src/usecase/decision.ts";

const access = (outcome: Finding["outcome"], reasonCodes: string[] = []): Finding => ({
  source: "access",
  outcome,
  reasonCodes,
  grantedByRoles: [],
});
const policy = (outcome: Finding["outcome"], reasonCodes: string[]): Finding => ({
  source: "policy",
  outcome,
  reasonCodes,
  prerequisites: [],
});

describe("combineFindings", () => {
  test("ensures Allow without findings", () => {
    expect(combineFindings([], "v")).toEqual({
      outcome: "Allow",
      findings: [],
      reasonCodes: [],
      policySetVersion: "v",
    });
  });

  test.each([
    [
      "Deny over Conditional",
      [policy("Conditional", ["policy.b"]), access("Deny", ["access.permission-not-held"])],
      "Deny",
    ],
    ["Conditional over Allow", [access("Allow"), policy("Conditional", ["policy.b"])], "Conditional"],
    ["Allow when every finding allows", [access("Allow")], "Allow"],
  ] as const)("ensures the most restrictive outcome: %s", (_name, findings, outcome) => {
    expect(combineFindings(findings, "v").outcome).toBe(outcome);
  });

  test("ensures the reason codes of every finding that is not Allow, unique and sorted, and every finding kept in order", () => {
    const findings = [
      access("Deny", ["access.permission-not-held"]),
      policy("Deny", ["policy.z", "policy.a"]),
      policy("Conditional", ["policy.a"]),
    ];
    const decision = combineFindings(findings, "v");
    expect(decision.reasonCodes).toEqual(["access.permission-not-held", "policy.a", "policy.z"]);
    expect(decision.findings).toEqual(findings);
  });
});

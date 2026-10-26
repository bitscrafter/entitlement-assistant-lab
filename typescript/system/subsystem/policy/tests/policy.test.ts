import { describe, expect, test } from "vitest";
import { combinePolicies, type Policy, policySetViolations } from "../src/model/policy.ts";

const policy = (policyKey: string, overrides: Partial<Policy> = {}): Policy => ({
  policyKey,
  description: `${policyKey} described`,
  governedActions: ["thing.do"],
  appliesWhen: `applies-${policyKey}`,
  requires: `requires-${policyKey}`,
  unmetOutcome: "Deny",
  prerequisites: [],
  ...overrides,
});
const APPROVAL = { prerequisiteKind: "Approval", fulfilledByPermission: "approval.decide" } as const;

/** Every expression named in `truths` holds; every other does not. */
const holding =
  (...truths: string[]) =>
  (expression: string) =>
    truths.includes(expression);

describe("combinePolicies", () => {
  test("ensures Allow when no governing policy is unmet", () => {
    const policies = [policy("a"), policy("b")];
    expect(combinePolicies(policies, "thing.do", holding("applies-a", "requires-a"))).toEqual({
      outcome: "Allow",
      reasonCodes: [],
      prerequisites: [],
    });
  });

  test("ensures Deny when any unmet policy denies, every unmet policy reported, sorted", () => {
    const policies = [
      policy("zeta", { unmetOutcome: "Conditional", prerequisites: [APPROVAL] }),
      policy("alpha"),
    ];
    expect(combinePolicies(policies, "thing.do", holding("applies-zeta", "applies-alpha"))).toEqual({
      outcome: "Deny",
      reasonCodes: ["policy.alpha", "policy.zeta"],
      prerequisites: [],
    });
  });

  test("ensures Conditional with every unmet policy's prerequisites when none denies", () => {
    const policies = [policy("a", { unmetOutcome: "Conditional", prerequisites: [APPROVAL] })];
    expect(combinePolicies(policies, "thing.do", holding("applies-a"))).toEqual({
      outcome: "Conditional",
      reasonCodes: ["policy.a"],
      prerequisites: [APPROVAL],
    });
  });

  test("ensures a policy that does not govern the action, or does not apply, is not evaluated further", () => {
    const evaluated: string[] = [];
    const holds = (expression: string) => {
      evaluated.push(expression);
      return false;
    };
    expect(
      combinePolicies([policy("other", { governedActions: ["thing.undo"] }), policy("a")], "thing.do", holds)
        .outcome,
    ).toBe("Allow");
    expect(evaluated).toEqual(["applies-a"]);
  });
});

describe("policySetViolations", () => {
  const known = new Set(["thing.do", "approval.decide"]);
  const check = (expression: string) => (expression.includes("bad") ? "does not type-check" : null);

  test("ensures a valid set has no violation", () => {
    expect(policySetViolations([policy("a", { prerequisites: [APPROVAL] })], known, check)).toEqual([]);
  });

  test.each([
    ["a key that is not kebab-case", [policy("Not_Kebab")], "policy Not_Kebab: the key is not kebab-case"],
    ["a repeated key", [policy("a"), policy("a")], "policy a: the key is not unique"],
    [
      "an unknown action",
      [policy("a", { governedActions: ["thing.fly"] })],
      "policy a: unknown action thing.fly",
    ],
    [
      "an unknown prerequisite permission",
      [
        policy("a", {
          prerequisites: [{ prerequisiteKind: "Approval", fulfilledByPermission: "nobody.decides" }],
        }),
      ],
      "policy a: unknown permission nobody.decides",
    ],
    [
      "a predicate that does not type-check",
      [policy("a", { requires: "bad" })],
      "policy a: requires: does not type-check",
    ],
  ] as const)("ensures %s is a violation", (_name, policies, violation) => {
    expect(policySetViolations(policies, known, check)).toEqual([violation]);
  });
});

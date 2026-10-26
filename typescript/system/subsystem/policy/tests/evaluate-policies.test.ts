import { describe, expect, test } from "vitest";
import { FixedClock } from "../../../adapter/clock/fixed-clock.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import type { PolicySet } from "../src/model/policy.ts";
import {
  EvaluatePolicies,
  PolicySetActivationCheck,
  PolicySetInactiveError,
} from "../src/usecase/evaluate-policies.ts";
import type { PolicyExpressionEvaluator } from "../src/usecase/policy-expression-evaluator.ts";
import type { PolicySetRepository } from "../src/usecase/policy-set-repository.ts";

const SET: PolicySet = {
  version: "v".repeat(43),
  policies: [
    {
      policyKey: "always-unmet",
      description: "Never met.",
      governedActions: ["thing.do"],
      appliesWhen: "true",
      requires: "false",
      unmetOutcome: "Deny",
      prerequisites: [],
    },
  ],
};

class ActivationRecord implements PolicySetRepository {
  active = true;
  checks = 0;
  async isActive(): Promise<boolean> {
    this.checks += 1;
    return this.active;
  }
  async register(): Promise<void> {}
  async activate(_version: string, _id: Uuid): Promise<void> {}
}

const literal: PolicyExpressionEvaluator = {
  check: () => null,
  evaluate: (expression) => expression === "true",
};
const START = new Date("2026-10-22T15:00:00Z");

function evaluatePolicies() {
  const clock = new FixedClock(START);
  const policySets = new ActivationRecord();
  const evaluate = new EvaluatePolicies({
    policySet: SET,
    evaluator: literal,
    policySets,
    activation: new PolicySetActivationCheck(),
    clock,
  });
  const request = {
    actionKey: "thing.do",
    attributes: { principal: {}, resource: {}, context: {}, environment: {} },
  };
  return { clock, policySets, evaluate, request };
}

describe("EvaluatePolicies", () => {
  test("ensures the combination of the governing policies while the set is active", async () => {
    const { evaluate, request } = evaluatePolicies();
    expect(await evaluate.execute(request)).toEqual({
      outcome: "Deny",
      reasonCodes: ["policy.always-unmet"],
      prerequisites: [],
    });
    expect(evaluate.policySetVersion).toBe(SET.version);
  });

  test("ensures no decision when the bundled set is not active", async () => {
    const { evaluate, policySets, request } = evaluatePolicies();
    policySets.active = false;
    await expect(evaluate.execute(request)).rejects.toBeInstanceOf(PolicySetInactiveError);
  });

  test("ensures the activation is confirmed at most once a minute, and checked again after", async () => {
    const { evaluate, policySets, clock, request } = evaluatePolicies();
    await evaluate.execute(request);
    clock.setTo(new Date(START.getTime() + 59_999));
    await evaluate.execute(request);
    expect(policySets.checks).toBe(1);

    policySets.active = false;
    clock.setTo(new Date(START.getTime() + 60_000));
    await expect(evaluate.execute(request)).rejects.toBeInstanceOf(PolicySetInactiveError);
    expect(policySets.checks).toBe(2);
  });
});

import { describe, expect, test } from "vitest";
import { CelPolicyExpressionEvaluator } from "../src/infra/cel-policy-expression-evaluator.ts";
import type { PolicyAttributes } from "../src/model/policy.ts";

const evaluator = new CelPolicyExpressionEvaluator();
const attributes = (overrides: Partial<PolicyAttributes>): PolicyAttributes => ({
  principal: {},
  resource: {},
  context: {},
  environment: {},
  ...overrides,
});

describe("CelPolicyExpressionEvaluator", () => {
  test("ensures null for a boolean expression over the schema", () => {
    expect(evaluator.check("principal.job_level >= 2 || principal.job_function == 'supervisor'")).toBeNull();
    expect(evaluator.check("has(context.quota) && context.quota <= 100")).toBeNull();
  });

  test.each([
    ["an unknown attribute", "resource.plan_kye == 'enterprise'", /plan_kye/],
    ["a type mismatch", "principal.job_level >= '2'", /overload/],
    ["a non-boolean expression", "principal.job_level + 1", /not bool/],
    ["a syntax error", "principal.job_level >=", /./],
  ])("ensures %s is reported", (_name, expression, problem) => {
    expect(evaluator.check(expression)).toMatch(problem);
  });

  test("ensures the expression's value over the attributes, integers included", () => {
    expect(evaluator.evaluate("principal.job_level >= 2", attributes({ principal: { job_level: 2 } }))).toBe(
      true,
    );
    expect(evaluator.evaluate("principal.job_level >= 2", attributes({ principal: { job_level: 1 } }))).toBe(
      false,
    );
  });

  test("ensures an absent attribute has no value", () => {
    const expression = "has(resource.plan_key) && resource.plan_key == 'enterprise'";
    expect(evaluator.evaluate(expression, attributes({ resource: {} }))).toBe(false);
    expect(evaluator.evaluate(expression, attributes({ resource: { plan_key: "enterprise" } }))).toBe(true);
  });

  test("ensures reading an absent attribute without has() rejects", () => {
    expect(() => evaluator.evaluate("context.quota <= 100", attributes({}))).toThrow();
  });
});

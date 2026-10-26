import type { PolicyAttributes } from "../model/policy.ts";

/** Parses, type-checks, and evaluates policy predicates over the attribute schema (policy expression evaluator). */
export interface PolicyExpressionEvaluator {
  /** @ensures null when the expression type-checks to a boolean over the attribute schema; otherwise why not. */
  check(expression: string): string | null;

  /**
   * @requires `check(expression)` is null.
   * @ensures The expression's value over `attributes`; an absent attribute has no value (`has()` is false).
   * @ensures An expression that cannot be evaluated (an absent attribute read without `has()`) rejects: the
   *          decision fails closed.
   */
  evaluate(expression: string, attributes: PolicyAttributes): boolean;
}

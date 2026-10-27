import type { Decision, DecisionOutcome } from "../../../../port/authorization-decider.ts";

const RESTRICTIVENESS: Readonly<Record<DecisionOutcome, number>> = { Allow: 0, Conditional: 1, Deny: 2 };

/**
 * One decision from several on the same request (AU-4: a case action on an account includes `account.read` on it as
 * a finding of its own decision; case-lifecycle Q1).
 *
 * @ensures The most restrictive outcome (AU-2); every finding kept, in order; the reason codes unique and sorted.
 * @ensures The policy set version of the first decision (all are made against the same active set).
 */
export function combineDecisions(first: Decision, ...rest: readonly Decision[]): Decision {
  const all = [first, ...rest];
  const outcome = all
    .map((decision) => decision.outcome)
    .reduce((most, next) => (RESTRICTIVENESS[next] > RESTRICTIVENESS[most] ? next : most));
  return {
    outcome,
    findings: all.flatMap((decision) => decision.findings),
    reasonCodes: [...new Set(all.flatMap((decision) => decision.reasonCodes))].sort(),
    policySetVersion: first.policySetVersion,
  };
}

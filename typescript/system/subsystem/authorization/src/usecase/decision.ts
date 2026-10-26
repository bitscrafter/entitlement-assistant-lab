import type { Decision, DecisionOutcome, Finding } from "../../../../port/authorization-decider.ts";

const RESTRICTIVENESS: Readonly<Record<DecisionOutcome, number>> = { Allow: 0, Conditional: 1, Deny: 2 };

/**
 * Combines the findings of a decision (AU-2).
 *
 * @ensures The outcome is the most restrictive finding's, `Allow` when there is none.
 * @ensures The reason codes are those of every finding that is not `Allow`, unique and sorted.
 * @ensures Every finding is kept, in the order the steps produced them.
 */
export function combineFindings(findings: readonly Finding[], policySetVersion: string): Decision {
  const outcome = findings.reduce<DecisionOutcome>(
    (most, finding) => (RESTRICTIVENESS[finding.outcome] > RESTRICTIVENESS[most] ? finding.outcome : most),
    "Allow",
  );
  const reasonCodes = [
    ...new Set(
      findings.filter((finding) => finding.outcome !== "Allow").flatMap((finding) => finding.reasonCodes),
    ),
  ].sort();
  return { outcome, findings, reasonCodes, policySetVersion };
}

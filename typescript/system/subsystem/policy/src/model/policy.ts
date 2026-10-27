/** A requirement in positive form on one or more actions (PO-1): when it applies, `requires` must hold. */
export interface Policy {
  readonly policyKey: string;
  /** The explanation shown to the CSR when the policy is unmet. */
  readonly description: string;
  readonly governedActions: readonly string[];
  readonly appliesWhen: string;
  readonly requires: string;
  readonly unmetOutcome: "Deny" | "Conditional";
  readonly prerequisites: readonly {
    readonly prerequisiteKind: "Approval";
    readonly fulfilledByPermission: string;
  }[];
}

/** Every policy evaluated together, versioned by the hash of its content (policy §1). */
export interface PolicySet {
  readonly version: string;
  readonly policies: readonly Policy[];
}

export type AttributeType = "string" | "int" | "bool" | "timestamp";

/** The closed, typed attribute schema (policy §4): expressions may use only these. */
export const ATTRIBUTE_SCHEMA = {
  principal: {
    account_id: "string",
    account_kind: "string",
    identity_kind: "string",
    department: "string",
    job_function: "string",
    job_level: "int",
  },
  resource: {
    account_id: "string",
    account_category: "string",
    plan_key: "string",
    plan_ladder_key: "string",
    tier_rank: "int",
    seats_in_use: "int",
  },
  context: {
    action_key: "string",
    duration_days: "int",
    coverage_source: "string",
    target_plan_key: "string",
    target_seat_quota: "int",
    target_tier_rank: "int",
    feature_key: "string",
    quota: "int",
    has_contact: "bool",
    contact_authenticated: "bool",
    requester_account_id: "string",
    confirmer_account_id: "string",
    actor_is_assignee: "bool",
    approval_granted: "bool",
  },
  environment: { now: "timestamp" },
} as const satisfies Readonly<Record<string, Readonly<Record<string, AttributeType>>>>;

type Schema = typeof ATTRIBUTE_SCHEMA;
type ValueOf<Type> = Type extends "string"
  ? string
  : Type extends "int"
    ? number
    : Type extends "bool"
      ? boolean
      : Date;

/** Attribute values by namespace; an absent attribute is an optional one with no value (tested with `has()`). */
export type PolicyAttributes = {
  readonly [Namespace in keyof Schema]: {
    readonly [Name in keyof Schema[Namespace]]?: ValueOf<Schema[Namespace][Name]>;
  };
};

/** The policy step's finding (PO-3). */
export interface PolicyFinding {
  readonly outcome: "Allow" | "Deny" | "Conditional";
  /** `policy.<policy_key>` of every unmet policy, sorted. */
  readonly reasonCodes: readonly string[];
  readonly prerequisites: readonly {
    readonly prerequisiteKind: "Approval";
    readonly fulfilledByPermission: string;
  }[];
}

/**
 * Combines every policy that governs the action and applies (PO-3).
 *
 * @ensures `Deny` when any unmet policy denies; otherwise `Conditional` with every unmet policy's prerequisites
 *          when any is unmet; otherwise `Allow`.
 * @ensures Every unmet policy is reported, as `policy.<policy_key>`, sorted.
 * @ensures A policy that does not govern the action, or does not apply, is never evaluated further.
 */
export function combinePolicies(
  policies: readonly Policy[],
  actionKey: string,
  holds: (expression: string) => boolean,
): PolicyFinding {
  const unmet = policies
    .filter((policy) => policy.governedActions.includes(actionKey))
    .filter((policy) => holds(policy.appliesWhen) && !holds(policy.requires))
    .sort((left, right) => left.policyKey.localeCompare(right.policyKey));
  const reasonCodes = unmet.map((policy) => `policy.${policy.policyKey}`);
  if (unmet.some((policy) => policy.unmetOutcome === "Deny"))
    return { outcome: "Deny", reasonCodes, prerequisites: [] };
  if (unmet.length > 0) {
    return {
      outcome: "Conditional",
      reasonCodes,
      prerequisites: unmet.flatMap((policy) => policy.prerequisites),
    };
  }
  return { outcome: "Allow", reasonCodes: [], prerequisites: [] };
}

/**
 * The build-time checks of a policy set (policy §6).
 *
 * @ensures Empty exactly when every policy key is unique and kebab-case, every governed action and prerequisite
 *          permission is a known action key, and both predicates of every policy type-check (`checkExpression`
 *          answers null).
 */
export function policySetViolations(
  policies: readonly Policy[],
  knownActionKeys: ReadonlySet<string>,
  checkExpression: (expression: string) => string | null,
): readonly string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const policy of policies) {
    const name = `policy ${policy.policyKey}`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(policy.policyKey))
      violations.push(`${name}: the key is not kebab-case`);
    if (seen.has(policy.policyKey)) violations.push(`${name}: the key is not unique`);
    seen.add(policy.policyKey);
    for (const action of policy.governedActions) {
      if (!knownActionKeys.has(action)) violations.push(`${name}: unknown action ${action}`);
    }
    for (const prerequisite of policy.prerequisites) {
      if (!knownActionKeys.has(prerequisite.fulfilledByPermission)) {
        violations.push(`${name}: unknown permission ${prerequisite.fulfilledByPermission}`);
      }
    }
    for (const [part, expression] of [
      ["applies_when", policy.appliesWhen],
      ["requires", policy.requires],
    ] as const) {
      const problem = checkExpression(expression);
      if (problem !== null) violations.push(`${name}: ${part}: ${problem}`);
    }
  }
  return violations;
}

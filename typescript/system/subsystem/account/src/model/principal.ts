import type { Uuid } from "../../../../kernel/identifier.ts";

export type HoldReason =
  | "OperationalSuspension"
  | "CustomerRemoved"
  | "NoActiveMembership"
  | "InternalIdentityInactive";

const HOLD_REASON_CODES: Readonly<Record<HoldReason, string>> = {
  OperationalSuspension: "account.operational-suspension",
  CustomerRemoved: "account.customer-removed",
  NoActiveMembership: "account.no-active-membership",
  InternalIdentityInactive: "account.internal-identity-inactive",
};

/** The employee a session acts for, loaded fresh for every request (CM-16). */
export interface EmployeePrincipal {
  readonly accountId: Uuid;
  readonly accountDisplayName: string;
  readonly internalIdentityId: Uuid;
  readonly departmentKey: string;
  readonly jobFunctionKey: string;
  readonly jobLevel: number;
}

/**
 * Why an account may not act: one reason code per unreleased hold, and the identity's status.
 *
 * @ensures Empty exactly when the account has no unreleased hold and its identity is active.
 * @ensures Reason codes are unique and sorted.
 */
export function principalRefusalReasons(
  holds: readonly HoldReason[],
  identityActive: boolean,
): readonly string[] {
  const reasons = new Set(holds.map((hold) => HOLD_REASON_CODES[hold]));
  if (!identityActive) reasons.add(HOLD_REASON_CODES.InternalIdentityInactive);
  return [...reasons].sort();
}

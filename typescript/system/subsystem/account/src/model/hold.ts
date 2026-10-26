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

/**
 * The reason codes of holds (account §3: hold reasons are reason codes in explanations).
 *
 * @ensures One code per distinct hold reason, sorted.
 */
export function holdReasonCodes(holds: readonly HoldReason[]): readonly string[] {
  return [...new Set(holds.map((hold) => HOLD_REASON_CODES[hold]))].sort();
}

import type { Uuid } from "./identifier.ts";

/** Where an effective entitlement comes from (entitlement §3). */
export type EntitlementSource =
  | { readonly kind: "plan"; readonly planKey: string }
  | { readonly kind: "addon"; readonly addonKey: string }
  | { readonly kind: "grant"; readonly grantId: Uuid };

/** A metered feature's quota; null for a feature that is not metered. */
export type Quota = number | "unlimited" | null;

export type TermSource = "FreePlan" | "Payment" | "Contract" | "Trial" | "Courtesy" | "Complimentary";

/** Facts that accompany a reason code (attribution §4a). */
export interface ReasonFacts {
  readonly lastTermSource?: TermSource;
  readonly lastTermEndedAt?: Date;
}

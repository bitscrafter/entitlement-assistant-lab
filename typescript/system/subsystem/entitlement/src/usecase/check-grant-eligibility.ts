import { type GrantAsked, grantRefusals } from "../model/grant-rules.ts";
import type { AccountEntitlements } from "./compute-effective-entitlements.ts";

export type { GrantAsked };

/**
 * Whether a grant may exist at all, given what the account has (EN-4, grants-and-approvals D11). It refuses; it sets
 * no limit (the limits are policies). Internal: the decision point's entitlement step calls it.
 */
export class CheckGrantEligibility {
  /** @ensures The reasons the grant may not be made on the subject now; empty when it may (`grantRefusals`). */
  execute(subject: AccountEntitlements, asked: GrantAsked): readonly string[] {
    return grantRefusals(subject.effective, asked, subject.meteredFeatureKeys.has(asked.featureKey));
  }
}

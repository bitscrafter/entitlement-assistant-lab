import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EntitlementGrant, Subscription } from "../model/effective-entitlements.ts";

export interface SubscriptionRepository {
  /**
   * @ensures The account's most recent subscription, in force or ended, with all its terms, add-ons, and grants;
   *          null when the account never subscribed.
   */
  latestOf(accountId: Uuid): Promise<Subscription | null>;

  /**
   * @ensures Every grant of the feature on the account, across all its subscriptions, that was still granting at or
   *          after `since` (ended or not), by start (grants-and-approvals D5).
   */
  grantsOf(accountId: Uuid, featureKey: string, since: Date): Promise<readonly EntitlementGrant[]>;
}

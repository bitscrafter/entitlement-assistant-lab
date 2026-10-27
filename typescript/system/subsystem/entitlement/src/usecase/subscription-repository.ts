import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Subscription } from "../model/effective-entitlements.ts";

export interface SubscriptionRepository {
  /**
   * @ensures The account's most recent subscription, in force or ended, with all its terms, add-ons, and grants;
   *          null when the account never subscribed.
   */
  latestOf(accountId: Uuid): Promise<Subscription | null>;
}

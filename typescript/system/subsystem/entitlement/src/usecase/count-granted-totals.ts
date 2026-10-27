import type { Uuid } from "../../../../kernel/identifier.ts";
import { daysGranted, GRANT_DAYS_LOOKBACK_DAYS, quotaGranted } from "../model/grant-rules.ts";
import type { SubscriptionRepository } from "./subscription-repository.ts";

/**
 * How much has been granted, the request included (grants-and-approvals D5): facts for the policies, which hold the
 * limits. Internal: the Policy Information Point calls it.
 */
export class CountGrantedTotals {
  readonly #subscriptions: SubscriptionRepository;

  constructor(dependencies: { readonly subscriptions: SubscriptionRepository }) {
    this.#subscriptions = dependencies.subscriptions;
  }

  /**
   * @ensures The days granted for the feature on the account within the 90 days before `now`, the requested window
   *          included, each day once (`daysGranted`).
   */
  async days(
    accountId: Uuid,
    featureKey: string,
    window: { readonly startsAt: Date; readonly endsAt: Date },
    now: Date,
  ): Promise<number> {
    const since = new Date(now.getTime() - GRANT_DAYS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    // Only the feature's grants still granting in the lookback are read (review R2-1).
    return daysGranted(
      await this.#subscriptions.grantsOf(accountId, featureKey, since),
      featureKey,
      window,
      since,
    );
  }

  /**
   * @ensures The quota the grant adds with the feature's other grants overlapping its window (`quotaGranted`): the
   *          quota limit counts them together (owner, 2026-10-27).
   */
  async quota(
    accountId: Uuid,
    featureKey: string,
    window: { readonly startsAt: Date; readonly endsAt: Date },
    quota: number,
    extendsGrantId: Uuid | null,
  ): Promise<number> {
    const overlapping = await this.#subscriptions.grantsOf(accountId, featureKey, window.startsAt);
    return quotaGranted(overlapping, featureKey, window, quota, extendsGrantId);
  }
}

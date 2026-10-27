import type { Uuid } from "../../../../kernel/identifier.ts";
import {
  daysGranted,
  GRANT_DAYS_LOOKBACK_DAYS,
  type GrantAsked,
  grantRefusals,
  quotaGranted,
} from "../model/grant-rules.ts";
import type { AccountEntitlements } from "./compute-effective-entitlements.ts";
import type { SubscriptionRepository } from "./subscription-repository.ts";

export type { GrantAsked };

/**
 * The grant rules for the decision point (EN-4, grants-and-approvals D5): what a grant may be, and the days it counts.
 * Internal: the Policy Information Point and the entitlement step call it.
 */
export class JudgeGrantChange {
  readonly #subscriptions: SubscriptionRepository;

  constructor(dependencies: { readonly subscriptions: SubscriptionRepository }) {
    this.#subscriptions = dependencies.subscriptions;
  }

  /** @ensures The reasons the grant may not be made on the subject now; empty when it may (`grantRefusals`). */
  refusals(subject: AccountEntitlements, asked: GrantAsked): readonly string[] {
    return grantRefusals(subject.effective, asked, subject.meteredFeatureKeys.has(asked.featureKey));
  }

  /**
   * @ensures The days granted for the feature on the subject within the 90 days before `now`, the requested window
   *          included, each day once (`daysGranted`).
   */
  async daysGranted(
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
   *          quota limit counts them together.
   */
  async quotaGranted(
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

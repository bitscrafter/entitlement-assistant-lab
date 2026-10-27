import type { Uuid } from "../../../../kernel/identifier.ts";
import type {
  CustomerAccountView,
  GetCustomerAccount,
} from "../../../account/src/usecase/get-customer-account.ts";
import type { GetCatalog } from "../../../product/src/usecase/get-catalog.ts";
import {
  type CatalogBundles,
  type EffectiveEntitlements,
  type EntitlementGrant,
  type EntitlementSnapshot,
  effectiveEntitlements,
  latestPlanKey,
} from "../model/effective-entitlements.ts";
import type { SubscriptionRepository } from "./subscription-repository.ts";

export type {
  EffectiveEntitlement,
  EffectiveEntitlements,
  EntitlementGrant,
  EntitlementSource,
  Quota,
  ReasonFacts,
} from "../model/effective-entitlements.ts";

export interface AccountEntitlements {
  readonly account: CustomerAccountView;
  readonly effective: EffectiveEntitlements;
  /** `resource.plan_key`: the plan of the latest term, current or ended (policy §4). */
  readonly latestPlanKey: string | null;
  /** The catalog's metered features (EN-4). */
  readonly meteredFeatureKeys: ReadonlySet<string>;
}

/**
 * What a subject account can use at an instant, computed fresh from its holds, subscription, and the catalog
 * (EN-6). Internal: other subsystems call it, no endpoint or tool does.
 */
export class ComputeEffectiveEntitlements {
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #getCatalog: GetCatalog;
  readonly #subscriptions: SubscriptionRepository;

  constructor(dependencies: {
    readonly getCustomerAccount: GetCustomerAccount;
    readonly getCatalog: GetCatalog;
    readonly subscriptions: SubscriptionRepository;
  }) {
    this.#getCustomerAccount = dependencies.getCustomerAccount;
    this.#getCatalog = dependencies.getCatalog;
    this.#subscriptions = dependencies.subscriptions;
  }

  /**
   * @ensures null when no customer account has this id; otherwise `effectiveEntitlements` at `at`.
   * @ensures With `assuming`, as if the grant change were made: `ending` ended at `at`, `adding` added to the latest
   *          subscription (the entitlement diff's "after", SU-4). Nothing is written.
   */
  async execute(request: {
    readonly accountId: Uuid;
    readonly at: Date;
    readonly assuming?: { readonly adding?: EntitlementGrant; readonly ending?: Uuid };
  }): Promise<AccountEntitlements | null> {
    const account = await this.#getCustomerAccount.execute(request.accountId);
    if (account === null) return null;
    const catalog = await this.#getCatalog.execute();
    const latest = await this.#subscriptions.latestOf(request.accountId);
    const assuming = request.assuming;
    const snapshot: EntitlementSnapshot = {
      holdReasonCodes: account.holdReasonCodes,
      latestSubscription:
        latest === null || assuming === undefined
          ? latest
          : {
              ...latest,
              grants: [
                ...latest.grants.map((grant) =>
                  grant.grantId === assuming.ending ? { ...grant, endedAt: request.at } : grant,
                ),
                ...(assuming.adding === undefined ? [] : [assuming.adding]),
              ],
            },
    };
    const bundles: CatalogBundles = {
      planBundles: new Map(catalog.plans.map((plan) => [plan.planKey, plan.bundles])),
      addonBundles: new Map(catalog.addons.map((addon) => [addon.addonKey, addon.bundles])),
      meteredFeatures: new Set(
        catalog.features
          .filter((feature) => feature.meteredUnit !== null)
          .map((feature) => feature.featureKey),
      ),
    };
    return {
      account,
      effective: effectiveEntitlements(snapshot, bundles, request.at),
      latestPlanKey: latestPlanKey(snapshot),
      meteredFeatureKeys: bundles.meteredFeatures,
    };
  }
}

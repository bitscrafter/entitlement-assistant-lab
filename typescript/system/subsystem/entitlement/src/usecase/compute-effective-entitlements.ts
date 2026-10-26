import type { Uuid } from "../../../../kernel/identifier.ts";
import type {
  CustomerAccountView,
  GetCustomerAccount,
} from "../../../account/src/usecase/get-customer-account.ts";
import type { GetCatalog } from "../../../product/src/usecase/get-catalog.ts";
import {
  type CatalogBundles,
  type EffectiveEntitlements,
  type EntitlementSnapshot,
  effectiveEntitlements,
  latestPlanKey,
} from "../model/effective-entitlements.ts";
import type { SubscriptionRepository } from "./subscription-repository.ts";

export type {
  EffectiveEntitlement,
  EffectiveEntitlements,
  EntitlementSource,
  Quota,
  ReasonFacts,
} from "../model/effective-entitlements.ts";

export interface AccountEntitlements {
  readonly account: CustomerAccountView;
  readonly effective: EffectiveEntitlements;
  /** `resource.plan_key`: the plan of the latest term, current or ended (policy §4). */
  readonly latestPlanKey: string | null;
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

  /** @ensures null when no customer account has this id; otherwise `effectiveEntitlements` at `at`. */
  async execute(request: {
    readonly accountId: Uuid;
    readonly at: Date;
  }): Promise<AccountEntitlements | null> {
    const account = await this.#getCustomerAccount.execute(request.accountId);
    if (account === null) return null;
    const catalog = await this.#getCatalog.execute();
    const snapshot: EntitlementSnapshot = {
      holdReasonCodes: account.holdReasonCodes,
      latestSubscription: await this.#subscriptions.latestOf(request.accountId),
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
    };
  }
}

/** What is sold (data-model/product.md): reference data, loaded once and checked by `catalogViolations`. */
export interface Feature {
  readonly featureKey: string;
  readonly productKey: string;
  /** Set exactly when the feature is metered. */
  readonly meteredUnit: string | null;
  readonly operations: readonly string[];
}

/** One feature included by a plan or an add-on; on a metered feature, a null quota means unlimited. */
export interface Bundle {
  readonly featureKey: string;
  readonly quota: number | null;
}

export interface Plan {
  readonly planKey: string;
  readonly planLadderKey: string;
  readonly tierRank: number;
  readonly planCategory: "Free" | "Paid";
  readonly bundles: readonly Bundle[];
}

export interface Addon {
  readonly addonKey: string;
  readonly bundles: readonly Bundle[];
  readonly eligiblePlanKeys: readonly string[];
}

export interface Catalog {
  readonly features: readonly Feature[];
  readonly plans: readonly Plan[];
  readonly addons: readonly Addon[];
}

/** What would make a feature available to an account (PR-10). */
export interface Remedy {
  /** The lowest-ranked plan of the account's ladder that includes the feature; null when none does. */
  readonly lowestPlanKey: string | null;
  /**
   * Every add-on that includes the feature, with the plans it can join, ordered by rank; the plans are left
   * out (empty) when the add-on can join the account's current plan.
   */
  readonly addons: readonly { readonly addonKey: string; readonly eligiblePlanKeys: readonly string[] }[];
}

/**
 * The catalog rules of product §3 that the database cannot check.
 *
 * @ensures Empty exactly when every bundle names a known feature, quotas appear only on metered features,
 *          every eligibility names a known plan, and every add-on adds something to each plan it is eligible on.
 */
export function catalogViolations(catalog: Catalog): readonly string[] {
  const features = new Map(catalog.features.map((feature) => [feature.featureKey, feature]));
  const plans = new Map(catalog.plans.map((plan) => [plan.planKey, plan]));
  const violations: string[] = [];
  const checkBundles = (owner: string, bundles: readonly Bundle[]) => {
    for (const bundle of bundles) {
      const feature = features.get(bundle.featureKey);
      if (feature === undefined)
        violations.push(`${owner} includes the unknown feature ${bundle.featureKey}`);
      else if (feature.meteredUnit === null && bundle.quota !== null) {
        violations.push(`${owner} sets a quota on the unmetered feature ${bundle.featureKey}`);
      }
    }
  };
  for (const plan of catalog.plans) checkBundles(`plan ${plan.planKey}`, plan.bundles);
  for (const addon of catalog.addons) {
    checkBundles(`add-on ${addon.addonKey}`, addon.bundles);
    for (const planKey of addon.eligiblePlanKeys) {
      const plan = plans.get(planKey);
      if (plan === undefined) {
        violations.push(`add-on ${addon.addonKey} is eligible on the unknown plan ${planKey}`);
        continue;
      }
      const included = new Set(plan.bundles.map((bundle) => bundle.featureKey));
      const addsSomething = addon.bundles.some(
        (bundle) => features.get(bundle.featureKey)?.meteredUnit !== null || !included.has(bundle.featureKey),
      );
      if (!addsSomething) violations.push(`add-on ${addon.addonKey} adds nothing to plan ${planKey}`);
    }
  }
  return violations;
}

/**
 * What would make `featureKey` available to an account on `currentPlanKey` (PR-10).
 *
 * @requires `currentPlanKey`, when given, is a plan of the catalog.
 * @ensures `lowestPlanKey` is the lowest-ranked plan of the current plan's ladder whose bundles include the feature.
 * @ensures Every add-on including the feature is listed; its plans are listed by rank unless it can join the current plan.
 */
export function remedyFor(catalog: Catalog, featureKey: string, currentPlanKey: string | null): Remedy {
  const ranks = new Map(catalog.plans.map((plan) => [plan.planKey, plan.tierRank]));
  const ladder = catalog.plans.find((plan) => plan.planKey === currentPlanKey)?.planLadderKey;
  const including = (bundles: readonly Bundle[]) =>
    bundles.some((bundle) => bundle.featureKey === featureKey);
  const lowestPlan = catalog.plans
    .filter((plan) => plan.planLadderKey === ladder && including(plan.bundles))
    .sort((left, right) => left.tierRank - right.tierRank)[0];
  return {
    lowestPlanKey: lowestPlan?.planKey ?? null,
    addons: catalog.addons
      .filter((addon) => including(addon.bundles))
      .map((addon) => ({
        addonKey: addon.addonKey,
        eligiblePlanKeys:
          currentPlanKey !== null && addon.eligiblePlanKeys.includes(currentPlanKey)
            ? []
            : [...addon.eligiblePlanKeys].sort(
                (left, right) => (ranks.get(left) ?? 0) - (ranks.get(right) ?? 0),
              ),
      })),
  };
}

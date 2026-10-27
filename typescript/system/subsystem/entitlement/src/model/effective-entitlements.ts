import type { EntitlementSource, Quota, ReasonFacts, TermSource } from "../../../../kernel/entitlement.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";

export type { EntitlementSource, Quota, ReasonFacts, TermSource };

export interface SubscriptionTerm {
  readonly planKey: string;
  readonly source: TermSource;
  readonly startsAt: Date;
  readonly scheduledEndAt: Date | null;
  readonly endedAt: Date | null;
}

export interface SubscriptionAddon {
  readonly addonKey: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface EntitlementGrant {
  readonly grantId: Uuid;
  readonly featureKey: string;
  readonly quota: number | null;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
}

export interface Subscription {
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly endReason: "Canceled" | "CustomerRemoved" | null;
  readonly terms: readonly SubscriptionTerm[];
  readonly addons: readonly SubscriptionAddon[];
  readonly grants: readonly EntitlementGrant[];
}

/** Everything the computation reads about one subject account. */
export interface EntitlementSnapshot {
  /** Reason codes of the account's unreleased holds (`account.operational-suspension`, …). */
  readonly holdReasonCodes: readonly string[];
  /** The account's most recent subscription, in force or ended; null when it never subscribed. */
  readonly latestSubscription: Subscription | null;
}

/** The part of the product catalog the computation needs. */
export interface CatalogBundles {
  readonly planBundles: ReadonlyMap<
    string,
    readonly { readonly featureKey: string; readonly quota: number | null }[]
  >;
  readonly addonBundles: ReadonlyMap<
    string,
    readonly { readonly featureKey: string; readonly quota: number | null }[]
  >;
  readonly meteredFeatures: ReadonlySet<string>;
}

export interface EffectiveEntitlement {
  readonly featureKey: string;
  readonly quota: Quota;
  readonly sources: readonly EntitlementSource[];
}

export type EffectiveEntitlements =
  | {
      readonly kind: "Effective";
      /** Ordered by feature key. */
      readonly entitlements: readonly EffectiveEntitlement[];
      readonly coveringTerm: {
        readonly planKey: string;
        readonly source: TermSource;
        readonly endsAt: Date | null;
      };
    }
  | { readonly kind: "None"; readonly reasonCodes: readonly string[]; readonly facts: ReasonFacts };

/** A term's effective end: when it was cut short, else its scheduled end, else none (entitlement §2). */
function effectiveEnd(term: SubscriptionTerm): Date | null {
  return term.endedAt ?? term.scheduledEndAt;
}

const activeAt = (start: Date, end: Date | null, at: Date) => start <= at && (end === null || at < end);

/**
 * What a subject account can use at an instant: the one building block of effective entitlements (EN-6).
 *
 * @ensures A suspended account has none: one reason code per distinct hold, sorted (AC-6).
 * @ensures Without a subscription in force, none: `entitlement.subscription-canceled` when the last one was canceled,
 *          otherwise `entitlement.no-subscription`.
 * @ensures Without a term covering `at`, none: `entitlement.no-covering-term`, with the last term's source and end as facts.
 * @ensures Otherwise, the covering term's plan bundles, the current add-ons' bundles, and the active grants (expired
 *          ones ignored), each feature listing all its sources: the plan first, then add-ons by key, then grants by start;
 *          the covering term is given with its plan, source, and effective end.
 * @ensures A metered feature's quota is the sum of its sources' quotas, or `unlimited` when any source has none;
 *          an unmetered feature's quota is null.
 */
export function effectiveEntitlements(
  snapshot: EntitlementSnapshot,
  catalog: CatalogBundles,
  at: Date,
): EffectiveEntitlements {
  if (snapshot.holdReasonCodes.length > 0) {
    return { kind: "None", reasonCodes: [...new Set(snapshot.holdReasonCodes)].sort(), facts: {} };
  }
  const subscription = snapshot.latestSubscription;
  if (subscription === null || !activeAt(subscription.startedAt, subscription.endedAt, at)) {
    const canceled = subscription?.endReason === "Canceled";
    return {
      kind: "None",
      reasonCodes: [canceled ? "entitlement.subscription-canceled" : "entitlement.no-subscription"],
      facts: {},
    };
  }
  const coveringTerm = subscription.terms.find((term) => activeAt(term.startsAt, effectiveEnd(term), at));
  if (coveringTerm === undefined) {
    const lastTerm = [...subscription.terms]
      .filter((term) => term.startsAt <= at)
      .sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())[0];
    const lastEnd = lastTerm === undefined ? null : effectiveEnd(lastTerm);
    return {
      kind: "None",
      reasonCodes: ["entitlement.no-covering-term"],
      facts:
        lastTerm === undefined
          ? {}
          : { lastTermSource: lastTerm.source, ...(lastEnd === null ? {} : { lastTermEndedAt: lastEnd }) },
    };
  }

  const contributions = new Map<string, { quotas: (number | null)[]; sources: EntitlementSource[] }>();
  const contribute = (featureKey: string, quota: number | null, entitlementSource: EntitlementSource) => {
    const contribution = contributions.get(featureKey) ?? { quotas: [], sources: [] };
    contribution.quotas.push(quota);
    contribution.sources.push(entitlementSource);
    contributions.set(featureKey, contribution);
  };
  for (const bundle of catalog.planBundles.get(coveringTerm.planKey) ?? []) {
    contribute(bundle.featureKey, bundle.quota, { kind: "plan", planKey: coveringTerm.planKey });
  }
  const currentAddons = subscription.addons
    .filter((addon) => activeAt(addon.startedAt, addon.endedAt, at))
    .sort((left, right) => left.addonKey.localeCompare(right.addonKey));
  for (const addon of currentAddons) {
    for (const bundle of catalog.addonBundles.get(addon.addonKey) ?? []) {
      contribute(bundle.featureKey, bundle.quota, { kind: "addon", addonKey: addon.addonKey });
    }
  }
  const activeGrants = subscription.grants
    .filter((grant) => activeAt(grant.startsAt, grant.endedAt, at) && at < grant.expiresAt)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  for (const grant of activeGrants)
    contribute(grant.featureKey, grant.quota, { kind: "grant", grantId: grant.grantId });

  const entitlements = [...contributions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([featureKey, { quotas, sources }]) => ({
      featureKey,
      quota: catalog.meteredFeatures.has(featureKey)
        ? quotas.some((quota) => quota === null)
          ? ("unlimited" as const)
          : quotas.reduce<number>((total, quota) => total + (quota ?? 0), 0)
        : null,
      sources,
    }));
  return {
    kind: "Effective",
    entitlements,
    coveringTerm: {
      planKey: coveringTerm.planKey,
      source: coveringTerm.source,
      endsAt: effectiveEnd(coveringTerm),
    },
  };
}

/**
 * The plan of the account's latest term, current or ended: `resource.plan_key` (policy §4).
 *
 * @ensures The plan of the latest subscription's term that started last; null when the account never had a term.
 */
export function latestPlanKey(snapshot: EntitlementSnapshot): string | null {
  const terms = snapshot.latestSubscription?.terms ?? [];
  return (
    [...terms].sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())[0]?.planKey ?? null
  );
}

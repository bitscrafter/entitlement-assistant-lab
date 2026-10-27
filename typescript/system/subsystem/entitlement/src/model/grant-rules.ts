import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EffectiveEntitlements, EntitlementGrant } from "./effective-entitlements.ts";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** How far back the day limits look (grants-and-approvals D5). */
export const GRANT_DAYS_LOOKBACK_DAYS = 90;

/** When a grant stopped or stops granting: its end when it was ended early, else its expiry. */
export function grantEnd(grant: EntitlementGrant): Date {
  return grant.endedAt !== null && grant.endedAt < grant.expiresAt ? grant.endedAt : grant.expiresAt;
}

/**
 * The days granted for a feature (grants-and-approvals D5): the requested window together with the feature's grants,
 * counted from `since`, each instant once however many grants cover it.
 *
 * @ensures The length of the union of the requested window and every grant of the feature, clipped to start no
 *          earlier than `since`, in days, a part of a day counting as a day.
 * @ensures Grants of other features, and grants that ended before `since`, count nothing.
 */
export function daysGranted(
  grants: readonly EntitlementGrant[],
  featureKey: string,
  window: { readonly startsAt: Date; readonly endsAt: Date },
  since: Date,
): number {
  const intervals = [
    { start: window.startsAt.getTime(), end: window.endsAt.getTime() },
    ...grants
      .filter((grant) => grant.featureKey === featureKey)
      .map((grant) => ({ start: grant.startsAt.getTime(), end: grantEnd(grant).getTime() })),
  ]
    .map(({ start, end }) => ({ start: Math.max(start, since.getTime()), end }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of intervals) {
    if (current !== null && interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
      continue;
    }
    if (current !== null) total += current.end - current.start;
    current = { ...interval };
  }
  if (current !== null) total += current.end - current.start;
  return Math.ceil(total / DAY_MILLISECONDS);
}

/** What a grant asks to add (EN-4). */
export interface GrantAsked {
  readonly featureKey: string;
  readonly quota: number | null;
  /** The grant an extension ends, whose own contribution does not count as already including the feature (D13). */
  readonly extendsGrantId: Uuid | null;
}

/**
 * What a grant may be (EN-4, grants-and-approvals D11): an unmetered feature the subject lacks, or added quota on a
 * metered feature, on a subscription in force.
 *
 * @ensures No subscription in force (none, ended, or canceled): `entitlement.no-subscription`.
 * @ensures Any other reason the subject has no entitlements is kept as it is.
 * @ensures A quota on an unmetered feature: `entitlement.quota-on-unmetered-feature`.
 * @ensures No quota on a metered feature: `entitlement.quota-required-on-metered-feature`.
 * @ensures An unmetered feature the subject already has from another source: `entitlement.feature-already-included`.
 * @ensures Otherwise no reason: the grant may be made.
 */
export function grantRefusals(
  effective: EffectiveEntitlements,
  asked: GrantAsked,
  metered: boolean,
): readonly string[] {
  if (effective.kind === "None") {
    return effective.reasonCodes.map((code) =>
      code === "entitlement.subscription-canceled" ? "entitlement.no-subscription" : code,
    );
  }
  if (!metered && asked.quota !== null) return ["entitlement.quota-on-unmetered-feature"];
  if (metered && asked.quota === null) return ["entitlement.quota-required-on-metered-feature"];
  if (metered) return [];
  const included = effective.entitlements
    .find((entitlement) => entitlement.featureKey === asked.featureKey)
    ?.sources.some((source) => source.kind !== "grant" || source.grantId !== asked.extendsGrantId);
  return included === true ? ["entitlement.feature-already-included"] : [];
}

/**
 * The quota a grant adds together with the feature's other grants that overlap its window (owner, 2026-10-27: the
 * quota limit is cumulative, as the day limits are).
 *
 * @ensures The requested quota plus the quota of every other grant of the feature granting at some instant of the
 *          window; the grant an extension ends is not counted twice.
 */
export function quotaGranted(
  grants: readonly EntitlementGrant[],
  featureKey: string,
  window: { readonly startsAt: Date; readonly endsAt: Date },
  quota: number,
  extendsGrantId: Uuid | null,
): number {
  return grants
    .filter(
      (grant) =>
        grant.featureKey === featureKey &&
        grant.grantId !== extendsGrantId &&
        grant.quota !== null &&
        grant.startsAt < window.endsAt &&
        grantEnd(grant) > window.startsAt,
    )
    .reduce((total, grant) => total + (grant.quota ?? 0), quota);
}

/** How long one session token lives (CM-16). */
export const TOKEN_LIFETIME_MILLISECONDS = 30 * 60 * 1000;

/** No session outlives its sign-in by more than this (absolute lifetime). */
export const ABSOLUTE_LIFETIME_MILLISECONDS = 8 * 60 * 60 * 1000;

/** @ensures Whole seconds from `now` until `instant`, never negative: a cookie's Max-Age. */
export function secondsUntil(instant: Date, now: Date): number {
  return Math.max(0, Math.round((instant.getTime() - now.getTime()) / 1000));
}

export type RenewalDecision =
  | { readonly kind: "NoChange" }
  | { readonly kind: "Renew"; readonly expiresAt: Date }
  | { readonly kind: "RefuseAtAbsoluteLifetime" };

/**
 * Decides what a renewal request does with a valid token.
 *
 * @requires `now` is before `expiresAt` (the token is valid).
 * @ensures Before the midpoint of the token's lifetime: `NoChange`.
 * @ensures Past it, when the token already ends at the absolute lifetime: `RefuseAtAbsoluteLifetime`.
 * @ensures Otherwise `Renew`, ending at the earlier of `now` + the token lifetime and the absolute lifetime.
 */
export function decideRenewal(
  token: { readonly authenticatedAt: Date; readonly issuedAt: Date; readonly expiresAt: Date },
  now: Date,
): RenewalDecision {
  const halfLife = token.issuedAt.getTime() + (token.expiresAt.getTime() - token.issuedAt.getTime()) / 2;
  if (now.getTime() < halfLife) return { kind: "NoChange" };
  const absoluteEnd = token.authenticatedAt.getTime() + ABSOLUTE_LIFETIME_MILLISECONDS;
  if (token.expiresAt.getTime() >= absoluteEnd) return { kind: "RefuseAtAbsoluteLifetime" };
  return {
    kind: "Renew",
    expiresAt: new Date(Math.min(now.getTime() + TOKEN_LIFETIME_MILLISECONDS, absoluteEnd)),
  };
}

export type Disclosure =
  | { readonly kind: "Allowed" }
  | { readonly kind: "Denied"; readonly reasonCodes: readonly string[] }
  | { readonly kind: "NotFound" };

/**
 * What a refusal may reveal to the principal who asked (AU-6, explain-access D3).
 *
 * @ensures `Allowed` exactly for an `Allow` decision.
 * @ensures `Denied` with the reason codes only for a principal who holds `account.read` and is stopped by policies
 *          alone; every other refusal is `NotFound`, indistinguishable from an account that does not exist.
 */
export function disclose(
  decision: { readonly outcome: "Allow" | "Deny" | "Conditional"; readonly reasonCodes: readonly string[] },
  principalHoldsRead: boolean,
): Disclosure {
  if (decision.outcome === "Allow") return { kind: "Allowed" };
  const stoppedByPoliciesOnly =
    decision.reasonCodes.length > 0 && decision.reasonCodes.every((code) => code.startsWith("policy."));
  return principalHoldsRead && stoppedByPoliciesOnly
    ? { kind: "Denied", reasonCodes: decision.reasonCodes }
    : { kind: "NotFound" };
}

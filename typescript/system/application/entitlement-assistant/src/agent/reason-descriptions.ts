/**
 * How a reason code reads to a CSR, for the codes the read tools return (data-model/attribution.md §4a). A policy's
 * reason reads as the policy's own description, which the policy set carries.
 */
export const REASON_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "account.operational-suspension": "The account is suspended by an employee.",
  "account.customer-removed": "The customer was removed.",
  "account.no-active-membership": "The person no longer belongs to an organization.",
  "account.internal-identity-inactive": "The employee is suspended or no longer employed.",
  "access.permission-not-held": "No role the person holds in this account allows it.",
  "entitlement.no-subscription": "The account has no subscription.",
  "entitlement.subscription-canceled": "The account's subscription was canceled.",
  "entitlement.no-covering-term": "No paid or free term covers today: the last one has ended.",
  "entitlement.feature-not-included": "The account's plan, add-ons, and grants do not include it.",
  "access.contact-permission-not-held":
    "The contact holds no role in this account that lets them ask for it.",
  "entitlement.feature-already-included": "The account already has this feature.",
  "entitlement.quota-on-unmetered-feature": "This feature has no quota: grant it without one.",
  "entitlement.quota-required-on-metered-feature": "This feature is metered: say how much quota to add.",
  "support.stale-change-request": "The account changed since the request was prepared.",
  "support.approval-denied": "A supervisor denied the approval.",
  "support.approval-expired": "No supervisor decided in time.",
};

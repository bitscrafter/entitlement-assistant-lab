# Entitlement — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | What each account has: its subscription and terms, grants, and effective entitlements. |
| **References** | • Model: [`../data-model/entitlement.md`](../data-model/entitlement.md)<br>• Diagram: [`../diagrams/entitlement.svg`](../diagrams/entitlement.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [EN-1](#en-1-a-subscription-is-active-or-canceled) | A subscription is Active or Canceled |
| [EN-2](#en-2-plan-and-add-ons-are-facts-in-time) | Plan and add-ons are facts in time |
| [EN-3](#en-3-access-periods-control-the-whole-subscription) | Access periods control the whole subscription |
| [EN-4](#en-4-grants-only-where-they-add-something) | Grants only where they add something |
| [EN-5](#en-5-grant-expiry-is-fail-safe-twice) | Grant expiry is fail-safe twice |
| [EN-6](#en-6-effective-entitlements-are-computed-by-one-building-block) | Effective entitlements are computed by one building block |
| [EN-7](#en-7-seats-in-use-are-counted-from-role-assignments) | Seats in use are counted from role assignments |
| [EN-8](#en-8-plan-changes-end-add-ons-that-no-longer-fit) | Plan changes end add-ons that no longer fit |
| [EN-9](#en-9-a-subscription-is-a-fact-in-time) | A subscription is a fact in time |
| [EN-10](#en-10-subscription-terms-one-timeline-of-plan-and-coverage) | Subscription terms: one timeline of plan and coverage |

---


## Decisions

### EN-1. A subscription is Active or Canceled

| | |
| :--- | :--- |
| **Decision** | A subscription is an account's relationship with a plan:<br>• `Active` (in force) or `Canceled` (final)<br>• subscribing again after a cancellation creates a new subscription<br>• at most one `Active` subscription per account<br>• only `Independent` accounts subscribe |
| **Status** | Superseded by EN-9 · 2026-10-23 · decided by the owner |
| **Context** | Entitlement records the result of commercial events, not the events themselves. |
| **Rationale** | • Payments stay out of the model: no past-due state.<br>• A final `Canceled` keeps each subscription's history clean. |
| **Related** | • [CI-3](customer-identity.md#ci-3-the-account-is-the-operational-identity)<br>• [EN-3](#en-3-access-periods-control-the-whole-subscription) |
| **Alternatives** | • `Trialing` and `PastDue` statuses: ties the model to payments; trials are terms (EN-3).<br>• A `Suspended` subscription: collides with account suspension; coverage is a term instead. |
| **Amendments** | 2026-10-24 — only `Standalone` customer accounts subscribe ([AN-2](account.md#an-2-the-account-category-is-immutable)). |

---

### EN-2. Plan and add-ons are facts in time

| | |
| :--- | :--- |
| **Decision** | Which plan and add-ons a subscription has are rows with start and end:<br>• `subscription_plan`: exactly one current per active subscription<br>• `subscription_addon`: at most one current per add-on<br>• each end records who and why |
| **Status** | Superseded by EN-10 · 2026-10-23 · decided by the owner |
| **Context** | Plans and add-ons change over a subscription's life. |
| **Rationale** | • Consistency with CM-11.<br>• History is a query ("what plan was Acme on in September?"), not an audit search. |
| **Related** | [CM-11](common.md#cm-11-status-for-lifecycles-timestamps-for-facts) |
| **Alternatives** | Plan and add-on columns on the subscription, history in the audit log. |

---

### EN-3. Access periods control the whole subscription

| | |
| :--- | :--- |
| **Decision** | Nothing from a subscription works unless an access period covers the current instant:<br>• plan features (paid and unpaid), add-ons, and grants alike<br>• no row means not covered<br>• an empty `ends_at` means no enforced end<br>• sources: `FreePlan`, `Payment`, `Contract`, `Trial`, `Courtesy`, `Complimentary` |
| **Status** | Superseded by EN-10 · 2026-10-23 · decided by the owner |
| **Context** | Billing, trials, contracts, and goodwill all decide *how long* an account is covered. |
| **Rationale** | • One rule: covered or not.<br>• Fail-safe: a missing record never opens access; unbounded access is a stated row.<br>• Billing's interface is adding periods; payments stay outside.<br>• Explanations name the fact ("payment period ended on Oct 15"). |
| **Consequences** | • `is_paid` leaves Product (PR-8).<br>• A Free plan subscription has an open-ended `FreePlan` period.<br>• `Courtesy` (temporary, always ends) and `Complimentary` (standing policy) need different authority. |
| **Examples** | Globex (Pro): last `Payment` period ended Oct 15, so nothing works until a new period. An Enterprise contract: one `Contract` period, open-ended. |
| **Related** | [PR-8](product.md#pr-8-metered-unit-and-quota) |
| **Alternatives** | • Absence means unbounded: a missing billing record opens paid access.<br>• Periods for paid features only, unpaid features from the plan: a lapsed Business account keeps 100 seats. |

---

### EN-4. Grants only where they add something

| | |
| :--- | :--- |
| **Decision** | A grant gives one account one feature until an expiry:<br>• allowed for an unmetered feature the account lacks<br>• allowed as a metered quota, added to the total<br>• needs a covering subscription term, like everything else |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | CSR goodwill and exceptions. |
| **Rationale** | The same rule as add-ons (PR-6): a grant for something the account has is noise. |
| **Examples** | SSO to Initech (Free) for 7 days: allowed. SSO to Acme (Business): refused. 10 seats to Acme for 30 days: 110 seats, then 100. |
| **Related** | [PR-6](product.md#pr-6-add-ons-only-where-they-add-something) |
| **Amendments** | 2026-10-23 — a grant references its subscription, not the account: the database enforces that it exists, and canceling the subscription ends its grants (`SubscriptionCanceled`). The "adds something" rule is checked at creation.<br>2026-10-25 — the grant no longer references its change request; Support records `change_request.created_grant_id` (CM-15). A grant needs a covering term like everything else.<br>2026-10-25 — "access period" reads "subscription term" (EN-10); `SubscriptionCanceled` reads `SubscriptionEnded`. |

---

### EN-5. Grant expiry is fail-safe twice

| | |
| :--- | :--- |
| **Decision** | A grant stops at `expires_at` in two ways:<br>• every evaluation ignores expired grants, at the exact instant<br>• `sys_grant_expiry` records the end (`Expired`) and its audit record |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Rationale** | A late or failed job never extends access; the end is still visible and attributed. |
| **Related** | [II-1](internal-identity.md#ii-1-internal-identity-as-supertype-with-employee-and-system-kinds) |
| **Amendments** | 2026-10-25 — the system permission is `grant.record-expiry`; `grant.revoke` means explicit early revocation by an employee (designed, not built).<br>2026-10-27 — `grant.revoke` is built (grants-and-approvals: `RevokeGrant` change requests), held through `grant.create` (grants-and-approvals D12). |

---

### EN-6. Effective entitlements are computed by one building block

| | |
| :--- | :--- |
| **Decision** | One computation, never stored, in this order:<br>• account suspended → nothing<br>• no active subscription → nothing<br>• no covering subscription term → nothing<br>• otherwise plan + add-ons + grants, each entitlement listing all its sources, metered quotas summed |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Rationale** | One algorithm: account-level questions and member explanations agree by construction; each stop has a reason code. |
| **Related** | [AC-6](access.md#ac-6-a-suspended-account-neither-acts-nor-is-changed) |
| **Amendments** | 2026-10-25 — step 2 reads "no subscription in force" (`entitlement.no-subscription`, `entitlement.subscription-canceled`); step 3 reads "no covering term" (`entitlement.no-covering-term`, with the last term's source).<br>2026-10-25 — "access period" reads "subscription term" (EN-10); `SubscriptionCanceled` reads `SubscriptionEnded`. |

---

### EN-7. Seats in use are counted from role assignments

| | |
| :--- | :--- |
| **Decision** | Seats in use are the distinct member accounts with at least one active role assignment in the account:<br>• a member with several roles counts once<br>• ended assignments do not count<br>• never stored |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Examples** | Acme: Olivia, Jane (two roles), Carol active, Dan ended → 3 seats. |
| **Related** | [AC-4](access.md#ac-4-account-role-assignments-justified-by-a-relationship) |
| **Amendments** | 2026-10-25 — the example's Acme also has Ben (billing): 4 seats. |

---

### EN-8. Plan changes end add-ons that no longer fit

| | |
| :--- | :--- |
| **Decision** | On a plan change, each current add-on is checked:<br>• included by the target plan → ends (`IncludedByPlan`)<br>• not eligible for the target plan → ends (`NotEligible`)<br>• a metered add-on still eligible → stays |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Consequences** | Shown in the proposal's entitlement diff. Implemented only if a scenario needs it; billing effects are listed in `production-readiness.md`. |
| **Related** | [PR-6](product.md#pr-6-add-ons-only-where-they-add-something) |
| **Amendments** | 2026-10-25 — the change-subscription feature's tests use accounts without add-ons; this rule stays deferred.<br>2026-10-25 — wording: shown in the change request's entitlement diff. |

---

### EN-9. A subscription is a fact in time

|  |  |
| :--- | :--- |
| **Decision** | A subscription starts, may end, and never reopens:<br>• `started_at`, `ended_at`, `ended_by`, `end_reason` (`Canceled`, `CustomerRemoved`); no status<br>• in force while `ended_at` is empty; at most one in force per account<br>• only `Standalone` customer accounts subscribe (every organization's account is `Standalone`)<br>• lapsed coverage is not an end: the subscription stays in force without a covering term |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Supersedes EN-1. Canceled was final, so by CM-11 the subscription is a fact in time, not a lifecycle. |
| **Related** | • [CM-11](common.md#cm-11-status-for-lifecycles-timestamps-for-facts)<br>• [AN-2](account.md#an-2-the-account-category-is-immutable) |
| **Alternatives** | A status `Active` or `Canceled` (EN-1): a fact encoded as a lifecycle. |

---

### EN-10. Subscription terms: one timeline of plan and coverage

|  |  |
| :--- | :--- |
| **Decision** | Which plan, and why it is covered, live in one timeline of terms:<br>• `subscription_term`: `plan_key`, `source` (`FreePlan`, `Payment`, `Contract`, `Trial`, `Courtesy`, `Complimentary`), `starts_at`, `scheduled_end_at`<br>• `scheduled_end_at` is immutable, empty only for `FreePlan`, `Contract`, `Complimentary`<br>• `ended_at`, `ended_by`, `end_reason` (`PlanChanged`, `SubscriptionCanceled`) when a term is cut short<br>• terms never overlap; `created_by` is an internal account (employee or system)<br>• nothing from the subscription works (plan, add-ons, grants) unless a term covers now; its plan is the current plan<br>• `FreePlan` terms only for plans whose `plan_category` is `Free` |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Supersedes EN-2 and EN-3, whose two timelines (plan, access period) let an open-ended free period cover a paid plan. |
| **Rationale** | • One question instead of two: is a term covering now, and with which plan?<br>• Fail-safe: no covering term, nothing works.<br>• Payments stay outside: billing adds `Payment` terms. |
| **Consequences** | • A mid-term plan change cuts the term short and starts a new one, adding its coverage in the same transaction (demo: `Trial` or `Courtesy`; production: billing).<br>• A change to a free plan starts an open-ended `FreePlan` term.<br>• Proration is listed in `production-readiness.md`. |
| **Examples** | Initech: `free`/`FreePlan` (open). Upgraded Oct 10: that term ends (`PlanChanged`), `pro`/`Trial` starts. |
| **Related** | • [PR-9](product.md#pr-9-plans-have-a-category)<br>• [EN-9](#en-9-a-subscription-is-a-fact-in-time) |
| **Alternatives** | • Separate plan and access-period timelines (EN-2, EN-3).<br>• Coverage compatible with any plan: free coverage of paid plans. |
| **Amendments** | 2026-10-25 — terms never start in the future; a plan change requires a covering term (otherwise `entitlement.no-covering-term`) and a target different from the current plan (`entitlement.plan-unchanged`); the coverage it adds is limited by policy. Children of an ended subscription end with `SubscriptionEnded`. When a trial ends with no new term, nothing works: the explanation says so. |

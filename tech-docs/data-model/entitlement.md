# Entitlement — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | What each subject account has: its subscription (terms and add-ons), the grants it receives, and the effective entitlements computed from them. Entitlement is one input to the authorization decision (AU-1). |
| **Status** | Ruled by the owner (2026-10-23; subscription terms 2026-10-25) |
| **References** | • Diagram: [`../diagrams/entitlement.er.puml`](../diagrams/entitlement.er.puml) (rendered: [`../diagrams/entitlement.svg`](../diagrams/entitlement.svg))<br>• Decisions: [`../adr/entitlement.md`](../adr/entitlement.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [Entities](#2-entities)
3. [Effective entitlements](#3-effective-entitlements)
4. [Seats in use](#4-seats-in-use)
5. [Plan changes](#5-plan-changes)
6. [Invariants](#6-invariants)
7. [Interfaces with other subsystems](#7-interfaces-with-other-subsystems)
8. [Not addressed](#8-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Subscription** | An account's relationship with the product: a fact in time, in force while not ended. Only a `Standalone` customer account subscribes (every organization's account is `Standalone`, AN-2). |
| **Subscription term** | A span of a subscription: which plan, and why it is covered (its **source**). Terms never overlap; the term covering the current instant gives the **current plan**. |
| **Term source** | `FreePlan` (the plan costs nothing), `Payment` (billing received a payment), `Contract` (negotiated terms), `Trial` (evaluation), `Courtesy` (a CSR's temporary goodwill), `Complimentary` (free of charge by standing policy). |
| **Subscription add-on** | An add-on included in a subscription, from when to when. |
| **Entitlement grant** | One feature given under a subscription, outside its plan, with a reason and an expiry. An exception someone decided, not derived from the plan. |
| **Effective entitlements** | What a subject account can use at an instant. Computed, never stored. |
| **Seats in use** | The number of different member accounts holding at least one active role assignment in the account. |

**Payments stay outside the model.** Billing's whole interface with Entitlement is adding `Payment`
terms and canceling subscriptions. A subscription whose coverage lapsed is still in force; it just has no
covering term.

## 2. Entities

| Entity | Key rules |
| --- | --- |
| `subscription` | Fact in time (EN-9): `started_at`, `ended_at`, `ended_by`, `end_reason` (`Canceled`, `CustomerRemoved`). At most one in force per account (partial unique index over rows not ended). Subscribing again after an end creates a new subscription. |
| `subscription_term` | Fact in time (EN-10): `plan_key`, `source`, `starts_at`, `scheduled_end_at` (immutable; empty only for `FreePlan`, `Contract`, `Complimentary`), and `ended_at`, `ended_by`, `end_reason` (`PlanChanged`, `SubscriptionEnded`) when cut short. `created_by` is an internal account: an employee in the demo; in production also billing's system account for `Payment` terms. Terms never overlap and never start in the future: `starts_at` is the instant the term is created (no scheduled changes). A `FreePlan` term only for a `Free` plan (PR-9). |
| `subscription_addon` | Fact in time. At most one current row per subscription and add-on. `end_reason`: `Removed`, `IncludedByPlan`, `NotEligible`, `SubscriptionEnded`. |
| `entitlement_grant` | Fact in time. References its subscription; ends with it (`SubscriptionEnded`). `expires_at` is required and later than `starts_at`. `quota` only for metered features. Several grants for one feature may coexist; their quotas add up. `end_reason`: `Revoked` (explicit early revocation, designed), `Expired`, `SubscriptionEnded`. Support records which change request created it (CM-15). |

**Ending a subscription** (cancellation, or the customer's removal) ends, in the same transaction, its
covering term, its current add-ons, and its active grants, each with `end_reason = SubscriptionEnded`.

**A term's effective end** is `ended_at` if set, otherwise `scheduled_end_at`, otherwise none. The
**covering term** is the one with `starts_at ≤ now` before its effective end; there is at most one.

| Situation | Terms |
| --- | --- |
| Initech on Free | `free` · `FreePlan` · open-ended |
| Upgraded to Pro on Oct 10 | the `FreePlan` term ends (`PlanChanged`); `pro` · `Trial` (demo) or `Payment` (production) starts |
| Monthly renewal | a new `pro` · `Payment` term starts where the last one ends |
| Goodwill during a billing problem | `pro` · `Courtesy`, up to 14 days |
| Enterprise contract | `enterprise` · `Contract` · open-ended |

## 3. Effective entitlements

Computed by one building block (EN-6), for a subject account at an instant, in this order:

| Step | Rule | Reason code when it stops |
| --- | --- | --- |
| 1 | The account is `Suspended` → nothing (AC-6). | one per unreleased hold: `account.operational-suspension`, `account.customer-removed`, `account.no-active-membership` |
| 2 | No subscription in force → nothing. | `entitlement.no-subscription`, or `entitlement.subscription-canceled` when the last one was canceled |
| 3 | No term covers the instant → nothing. | `entitlement.no-covering-term`, with the last term's source as a fact ("payment term ended on Oct 1") |
| 4 | Otherwise: the covering term's plan bundles, plus the current add-ons' bundles, plus active grants. A feature none of them includes: `entitlement.feature-not-included`. | — |

Each effective entitlement lists **all** its sources (plan, add-on, grant). For a metered feature, the
quota is the sum of the sources' quotas; an empty quota on any source means unlimited.

**Grants only where they add something.** At creation, a grant is allowed only for an unmetered feature
the account lacks, or as a metered quota (added to the total) (EN-4). A grant that later becomes redundant
(after an upgrade) is harmless: the entitlement lists both sources.

**Grant expiry, fail-safe twice.** Every evaluation ignores grants past `expires_at`, so access stops at
the exact instant. `sys_grant_expiry` then records the end (`end_reason = Expired`, permission
`grant.record-expiry`) and its audit record (EN-5).

## 4. Seats in use

The distinct `member_account_id` values among the account's active account role assignments. A member
with several roles counts once; ended assignments do not count. Counted, never stored. A plan change is
refused when seats in use exceed the **effective** seat quota after the change: the target plan's bundle
plus remaining add-ons plus active grants (`policy.downgrade-fits-seats`).

## 5. Plan changes

A plan change ends the covering term (`PlanChanged`) and starts a new term with the target plan, in one
transaction. The target is never the current plan (`entitlement.plan-unchanged`, refused when the change is
prepared).

| Change | New term |
| --- | --- |
| To a `Free` plan (a downgrade) | `FreePlan`, open-ended, starting now |
| To a `Paid` plan | the coverage given in the change request, starting now: demo `Trial` or `Courtesy`, within the policy limits (14 days each); production billing's `Payment` |
| To a `Paid` plan without coverage | refused: a term without a source would cover nothing |

Ending the subscription (`subscription.cancel`) is not a plan change: see "Ending a subscription" in §2.
When a `Trial` term ends, nothing follows it: the account has no covering term, and the explanation says
so with the last term's source (production converts or falls back, see production-readiness).

Current add-ons are checked against the target plan (EN-8, deferred: the change-subscription feature uses accounts without
add-ons):

| Case | Effect | `end_reason` |
| --- | --- | --- |
| The target plan includes the add-on's features | the add-on ends | `IncludedByPlan` |
| The add-on is not eligible for the target plan | the add-on ends; its features are lost | `NotEligible` |
| A metered add-on still eligible | it stays; quotas add to the new plan's | — |

The change request's entitlement diff shows these effects before confirmation.

## 6. Invariants

| Invariant | Guard |
| --- | --- |
| Only `Standalone` customer accounts subscribe. | foreign key to `customer_account`; subscription use case checks the category; verification test |
| At most one subscription in force per account. | partial unique index |
| Terms of a subscription never overlap. | term use case; verification test |
| `scheduled_end_at` is set for `Payment`, `Trial`, `Courtesy`; never changed. | check constraint; no use case updates it |
| `FreePlan` terms only for `Free` plans. | term use case; verification test |
| Without a covering term, nothing from the subscription works. | effective-entitlement building block; verification test |
| A grant always expires; quotas only on metered features. | `expires_at` not null; grant use case |
| Subscriptions, terms, add-ons, and grants are never deleted. | no `DELETE` for the application's database role (CM-7) |

## 7. Interfaces with other subsystems

| Subsystem | Relationship |
| --- | --- |
| Account | Subscriptions reference `Standalone` customer accounts. Every `*_by` column references `account`. |
| Access | Seats in use are counted from account role assignments. |
| Product | Plans (with `plan_category`), add-ons, bundles, quotas, metered units, eligibility. |
| Support | Applied change requests create terms, add-ons, and grants; Support records the grant a change created. |
| Policy | Limits on grant duration and quota, courtesy and trial coverage, the effective-seats check, upgrade and cancellation approval. |

## 8. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): the billing integration, proration
and credits, scheduled changes, trial conversion, grace periods (billing's decision), usage metering
beyond seats.

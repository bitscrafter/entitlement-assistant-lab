# Product — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | The catalog of what is sold: products and their features, plans arranged in ladders, add-ons, and what each plan and add-on includes. Reference data: seeded, versioned with the code, never changed by the assistant. Which account has what belongs to Entitlement. |
| **Status** | Ruled by the owner (2026-10-23) |
| **References** | • Diagram: [`../diagrams/product.er.puml`](../diagrams/product.er.puml) (rendered: [`../diagrams/product.svg`](../diagrams/product.svg))<br>• Decisions: [`../adr/product.md`](../adr/product.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [Entities](#2-entities)
3. [Catalog rules](#3-catalog-rules)
4. [Seeded catalog](#4-seeded-catalog)
5. [Interfaces with other subsystems](#5-interfaces-with-other-subsystems)
6. [Not addressed](#6-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Product** | What is built: a set of features. |
| **Feature** | A capability of a product; the unit of entitlement. Belongs to exactly one product. May be **metered** (measured in a **metered unit**, such as seats). |
| **Feature operation** | Something that can be done with a feature (`configure`, `create-token`, `export`, `view`). Access builds feature permissions from it. |
| **Plan ladder** | How the catalog is sold to one audience or purpose: a ladder of comparable plans (`standard`; a real catalog might add `security-suite` or `education`). |
| **Plan** | One step of a ladder: a chosen set of features with quotas. Not owned by a product; its products are those of its features. |
| **Plan category** | `Free` (costs nothing; covered by `FreePlan` terms) or `Paid` (PR-9). |
| **Tier rank** | A plan's position within its ladder. Moving to a higher rank in the same ladder is an upgrade, to a lower one a downgrade; moving between ladders is neither. |
| **Add-on** | A set of features bought on top of a plan. Not owned by a product. |
| **Bundle** | One feature included by a plan (`plan_feature_bundle`) or an add-on (`addon_feature_bundle`), with its quota. |
| **Quota** | The maximum quantity of a metered feature. Empty means unlimited. |
| **Add-on eligibility** | Which plans an add-on can join. |

## 2. Entities

| Entity | Key rules |
| --- | --- |
| `product` | One row in the demo. Groups features. |
| `feature` | References its product. `metered_unit` is set exactly when the feature is metered. |
| `feature_operation` | Primary key `(feature_key, operation)`. |
| `plan_ladder` | One row in the demo: `standard`. |
| `plan` | References its ladder. `(plan_ladder_key, tier_rank)` is unique. `plan_category` is `Free` or `Paid`. |
| `addon` | Name and description only. |
| `plan_feature_bundle`, `addon_feature_bundle` | Primary key `(plan or add-on, feature)`. `quota` is forbidden on unmetered features; on metered features, empty means unlimited. |
| `addon_plan_eligibility` | Primary key `(addon_key, plan_key)`. |
| `plan_product` (view) | The products of each plan, derived from its bundles. |

## 3. Catalog rules

Checked when the catalog is loaded, which refuses a catalog that breaks them:

| Rule | Why |
| --- | --- |
| A quota appears only on a metered feature. | An on/off feature has nothing to count. |
| An add-on is eligible for a plan only if it adds something: an unmetered feature the plan lacks, or a metered quota. | An add-on for a feature the plan already includes adds nothing. |
| Every reference (feature, operation, plan, add-on, ladder) resolves. | Foreign keys, plus the closed value lists of Access (AC-3). |

**Authoring shortcut.** The catalog file may say that a plan includes *every feature of a product*. Loading
expands it into one bundle per feature, so the data stays explicit and a new feature becomes a visible
new row when the catalog is reloaded.

**Quotas from add-ons add up.** For a metered feature, an add-on's quota adds to the plan's (a 10-seat
pack on Business gives 110 seats). How grants combine with them is defined by Entitlement.

## 4. Seeded catalog

Product: one. Ladder: `standard` — `free` (1, Free), `pro` (2, Paid), `business` (3, Paid), `enterprise` (4, Paid).

| Feature | Metered unit | Operations | free | pro | business | enterprise |
| --- | --- | --- | --- | --- | --- | --- |
| `seats` | seats | — | 3 | 25 | 100 | unlimited |
| `api-access` | — | `create-token` | — | ✓ | ✓ | ✓ |
| `sso` | — | `configure` | — | — | ✓ | ✓ |
| `audit-log-export` | — | `export` | — | — | ✓ | ✓ |
| `advanced-analytics` | — | `view` | — | — | — | ✓ |

Add-on `advanced-analytics`: includes `advanced-analytics`; eligible on `pro` and `business`.

## 5. Interfaces with other subsystems

| Subsystem | Relationship |
| --- | --- |
| Access | Feature permissions reference `feature_operation` (AC-3). |
| Entitlement | Subscriptions reference a plan and add-ons; grants reference a feature. Effective entitlements read bundles, quotas, and eligibility. Plan changes check add-ons (an add-on the target plan includes, or no longer accepts, is removed as part of the change). |
| Support | Access explanations name remedies (PR-10): the lowest-ranked plan of the account's ladder that includes the feature, and each add-on that includes it, with the plans it is eligible on when the current plan is not one of them. |

## 6. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): pricing and currencies, billing
intervals, plan versioning and grandfathering, retiring plans and add-ons, usage metering, quotas per
period, regional availability, and the billing side of add-on removal on a plan change.

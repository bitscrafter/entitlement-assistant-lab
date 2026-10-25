# Product — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | The catalog of what is sold: products and features, plans in ladders, add-ons, and what each includes. |
| **References** | • Model: [`../data-model/product.md`](../data-model/product.md)<br>• Diagram: [`../diagrams/product.svg`](../diagrams/product.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [PR-1](#pr-1-a-product-table-features-belong-to-one-product) | A product table; features belong to one product |
| [PR-2](#pr-2-plans-and-add-ons-are-independent-of-products) | Plans and add-ons are independent of products |
| [PR-3](#pr-3-plan-ladders-rank-plans) | Plan ladders rank plans |
| [PR-4](#pr-4-plan-feature-bundles-are-the-only-source-of-what-a-plan-includes) | Plan-feature bundles are the only source of what a plan includes |
| [PR-5](#pr-5-paid-metered-unit-and-quota) | Paid, metered unit, and quota |
| [PR-6](#pr-6-add-ons-only-where-they-add-something) | Add-ons only where they add something |
| [PR-7](#pr-7-the-catalog-is-seeded-pricing-is-out-of-scope) | The catalog is seeded; pricing is out of scope |
| [PR-8](#pr-8-metered-unit-and-quota) | Metered unit and quota |
| [PR-9](#pr-9-plans-have-a-category) | Plans have a category |
| [PR-10](#pr-10-remedies-name-a-plan-and-eligible-add-ons) | Remedies name a plan and eligible add-ons |

---


## Decisions

### PR-1. A product table; features belong to one product

| | |
| :--- | :--- |
| **Decision** | Products are rows in a `product` table:<br>• one row in the demo<br>• every feature belongs to exactly one product |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | The catalog. |
| **Rationale** | • Evolvability: shaped for many products (CM-6).<br>• Permissions and any later per-product scope reach the product through the feature. |
| **Related** | [CM-6](common.md#cm-6-shape-for-many-constrain-to-one) |

---

### PR-2. Plans and add-ons are independent of products

| | |
| :--- | :--- |
| **Decision** | Neither plans nor add-ons belong to a product:<br>• their bundles may include features of any product<br>• a plan's products are derived from its features (`plan_product` view) |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | A plan or an add-on may span several products (a suite). |
| **Rationale** | A one-product plan and a suite are the same structure; nothing special is built for suites. |
| **Consequences** | Nothing in the database prevents a plan from mixing products by accident; mixing is allowed by design. |
| **Examples** | `pro`: features of one product. A hypothetical `suite-basic`: `sso` from one product and threat alerts from another. |
| **Alternatives** | A plan owned by one product: cannot express a suite. |

---

### PR-3. Plan ladders rank plans

|  |  |
| :--- | :--- |
| **Decision** | Plans belong to a `plan_ladder`, a ladder of comparable plans:<br>• `tier_rank` is unique within the ladder<br>• a higher rank in the same ladder is an upgrade, a lower one a downgrade<br>• a move between ladders is neither |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | With plans independent of products, ranking needs another scope. |
| **Rationale** | A ladder packages the catalog for one audience or purpose; only plans of one ladder are meaningfully ordered. |
| **Examples** | `standard`: `free` (1) → `pro` (2) → `business` (3) → `enterprise` (4). |
| **Alternatives** | • One global rank: forces an arbitrary order between unrelated plans.<br>• No rank, upgrade computed as a superset: remedies still need an order. |
| **Amendments** | 2026-10-23 — term renamed from *plan family* to *plan ladder*, which says better what it is. |

---

### PR-4. Plan-feature bundles are the only source of what a plan includes

| | |
| :--- | :--- |
| **Decision** | What a plan includes is one row per feature:<br>• no plan–product link<br>• the catalog file may say "every feature of a product", expanded into rows when loaded |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Plans of one product differ feature by feature, and quotas differ per plan. |
| **Rationale** | • Explicitness: explanations cite the exact row that grants a feature.<br>• Safety: a new feature never reaches a plan silently; it appears as new rows on reload. |
| **Alternatives** | A plan–product link meaning "all features": includes features that do not exist yet, without review. |

---

### PR-5. Paid, metered unit, and quota

| | |
| :--- | :--- |
| **Decision** | A feature carries two facts, and bundles carry quotas:<br>• `is_paid`: lost when a subscription lapses<br>• `metered_unit`: set exactly when the feature is metered (no separate flag)<br>• `quota` on a bundle: forbidden on unmetered features; empty on metered ones means unlimited |
| **Status** | Superseded by PR-8 · 2026-10-23 · decided by the owner |
| **Context** | Entitlement queries both facts: features lost on lapse, features with quotas. |
| **Rationale** | • No redundant flag: metered means having a unit.<br>• Explanations name the unit ("100 seats"). |
| **Alternatives** | • One bit field for both flags: unreadable queries, no constraints.<br>• `is_paid` derived from the free plan: assumes a known free plan. |

---

### PR-6. Add-ons only where they add something

| | |
| :--- | :--- |
| **Decision** | An add-on is eligible for a plan only if it adds something:<br>• an unmetered feature the plan lacks, or<br>• a metered quota, which adds to the plan's |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | `addon_plan_eligibility`, checked when the catalog is loaded. |
| **Rationale** | An add-on for a feature the plan already includes would be paid for twice. |
| **Consequences** | A plan change removes add-ons the target plan includes or no longer accepts, shown in the change's entitlement diff (Entitlement). |
| **Examples** | `advanced-analytics` is eligible on `pro` and `business`, not on `enterprise`, which includes it. A 10-seat pack on `business` gives 110 seats. |

---

### PR-7. The catalog is seeded; pricing is out of scope

| | |
| :--- | :--- |
| **Decision** | The catalog is reference data:<br>• seeded and versioned with the code<br>• never changed by the assistant<br>• no prices, currencies, or billing intervals |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | No scenario charges money. |
| **Consequences** | Plan versioning, grandfathering, and retiring plans are listed in `production-readiness.md`. |

---

### PR-8. Metered unit and quota

|  |  |
| :--- | :--- |
| **Decision** | A feature carries one fact, and bundles carry quotas:<br>• `metered_unit`: set exactly when the feature is metered<br>• `quota` on a bundle: forbidden on unmetered features; empty on metered ones means unlimited<br>• no `is_paid` |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Supersedes PR-5. Access periods control paid and unpaid features alike (EN-3), so nothing distinguishes them at evaluation. |
| **Rationale** | A column with no reader is noise. |
| **Related** | • [PR-5](#pr-5-paid-metered-unit-and-quota)<br>• [EN-3](entitlement.md#en-3-access-periods-control-the-whole-subscription) |
| **Alternatives** | Keep `is_paid` (PR-5): only meaningful if paid and unpaid features lapsed differently. |

---

### PR-9. Plans have a category

|  |  |
| :--- | :--- |
| **Decision** | Each plan has a `plan_category`:<br>• `Free`: costs nothing; covered by open-ended `FreePlan` terms<br>• `Paid`: covered by `Payment`, `Contract`, `Trial`, `Courtesy`, or `Complimentary` terms |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Prices are not modeled, yet coverage must know which plans are free (EN-10). |
| **Related** | [EN-10](entitlement.md#en-10-subscription-terms-one-timeline-of-plan-and-coverage) |

---

### PR-10. Remedies name a plan and eligible add-ons

|  |  |
| :--- | :--- |
| **Decision** | The remedy for a feature an account lacks:<br>• the lowest-ranked plan of the account's plan ladder that includes the feature<br>• each add-on that includes it, with the plans it is eligible on when the current plan is not one of them |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Examples** | Initech (free) lacks advanced-analytics: plan `enterprise`; add-on `advanced-analytics` with plan `pro` or `business`. |
| **Related** | [PR-6](#pr-6-add-ons-only-where-they-add-something) |

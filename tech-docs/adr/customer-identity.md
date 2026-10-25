# Customer Identity — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | Who the provider's customers are, how people relate to organizations, and the account through which each customer operates. |
| **References** | • Model: [`../data-model/customer-identity.md`](../data-model/customer-identity.md)<br>• Diagram: [`../diagrams/customer-identity.svg`](../diagrams/customer-identity.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number                                                             | Name                                                  |
| :----------------------------------------------------------------- | :---------------------------------------------------- |
| [CI-1](#ci-1-customer-as-supertype-with-subtype-tables)            | Customer as supertype with subtype tables             |
| [CI-2](#ci-2-one-identity-per-person-membership-is-a-relationship) | One identity per person; membership is a relationship |
| [CI-3](#ci-3-the-account-is-the-operational-identity)              | The account is the operational identity               |
| [CI-4](#ci-4-roles-live-in-access-on-accounts)              | Roles live in Access, on accounts              |
| [CI-5](#ci-5-account-status-as-fail-safe-with-a-hold-per-cause)    | Account status as fail-safe, with a hold per cause    |
| [CI-6](#ci-6-the-term-customer)                                    | The term Customer                                     |

---


## Decisions

### CI-1. Customer as supertype with subtype tables

|                  |                                                                                                                                                                                                                                                                              |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Customers are stored as a supertype with one table per kind:<br>• `customer`: what both kinds share<br>• `organization` and `individual`: what is specific, keyed by `customer_id`<br>• A composite foreign key `(customer_id, customer_kind)` ties each subtype to its kind |
| **Status**       | Accepted · 2026-10-23 · decided by the owner (may be revisited)                                                                                                                                                                                                              |
| **Context**      | Organizations and individuals are sibling kinds of customer.                                                                                                                                                                                                                 |
| **Rationale**    | • Integrity: each kind's columns can be required, and the database refuses a mismatched kind.<br>• Simplicity: other subsystems reference one `customer_id`.                                                                                                                 |
| **Consequences** | • One join to read kind-specific columns.<br>• Subtype rows exist because creation is one transaction.                                                                                                                                                                       |
| **Alternatives** | • One table with a kind column: nullable columns.<br>• Two independent tables: every reference needs two nullable columns.                                                                                                                                                   |

---

### CI-2. One identity per person; membership is a relationship

|  |  |
| :--- | :--- |
| **Decision**     | A person is one identity:<br>• Exactly one `individual` per person<br>• Belonging to an organization is an `organization_membership`<br>  ◦ with its own id and status<br>  ◦ with no role |
| **Status**       | Accepted · 2026-10-23 · decided by the owner                                                                                                                                               |
| **Context**      | An individual may subscribe alone, belong to an organization, or both.                                                                                                                     |
| **Rationale**    | • No duplicate identities for one person.<br>• History is kept across leaving and rejoining.                                                                                               |
| **Consequences** | At most one active membership per individual (CM-6).                                                                                                                                       |
| **Examples**     | Jane has her own Pro account and is a member of Acme Corp.                                                                                                                                 |
| **Alternatives** | A separate organization-member identity: the same person twice.                                                                                                                            |
| **Amendments** | 2026-10-23 — the membership has start and end timestamps instead of a status ([CM-11](common.md#cm-11-status-for-lifecycles-timestamps-for-facts)).<br>2026-10-25 — `ended_by` is dropped from the membership; the audit records who ended it (CM-15). |

---

### CI-3. The account is the operational identity

|                  |                                                                                                                                                                                                                                                                                                            |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Every customer owns exactly one account: what acts and what is acted on.<br>• An organization's account is always `Independent`<br>• An individual's account has an operating mode:<br>  ◦ `Independent`: may hold its own subscription<br>  ◦ `OrganizationOnly`: acts only through organization accounts |
| **Status** | Superseded by AN-2 · 2026-10-23 · decided by the owner |
| **Context**      | Attribution, authorization, and entitlements all name accounts.                                                                                                                                                                                                                                            |
| **Rationale**    | • Attribution names an account, never personal data.<br>• One uniform target for roles.                                                                                                                                                                                                                    |
| **Consequences** | • Entitlements belong to an account and never flow between accounts.<br>• Every question is asked in an account context.                                                                                                                                                                                   |
| **Examples**     | Bob, an Acme employee with no subscription of his own, has an `OrganizationOnly` account.                                                                                                                                                                                                                  |
| **Related**      | • [CI-4](#ci-4-roles-live-in-access-on-accounts)<br>• [CI-5](#ci-5-account-status-as-fail-safe-with-a-hold-per-cause)                                                                                                                                                                                                                                                                                           |
| **Alternatives** | Zero or one account per individual: ruled first, then replaced the same day; role assignments would reference individuals directly.                                                                                                                                                                        |

---

### CI-4. Roles live in Access, on accounts

|                  |                                                                                                                                                                                                                                                                                             |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Decision**     | Roles are role assignments in Access, from a member account to a target account:<br>• Own-account roles are explicit<br>• Every assignment needs a justifying relationship:<br>  ◦ the same account, or<br>  ◦ an active membership in the organization that owns the target account |
| **Status**       | Accepted · 2026-10-23 · decided by the owner                                                                                                                                                                                                                                                |
| **Context**      | The boundary between Customer Identity and Access.                                                                                                                                                                                                                                   |
| **Rationale**    | • One authorization rule for every case.<br>• Dependents can hold restricted roles in their own accounts.                                                                                                                                                                                   |
| **Examples**     | • Jane's account → `acc_jane`: Owner.<br>• Jane's account → `acc_acme`: Admin.                                                                                                                                                                                                              |
| **Related**      | • [CI-3](#ci-3-the-account-is-the-operational-identity)<br>• [AC-4](access.md#ac-4-account-role-assignments-justified-by-a-relationship)                                                                                                                                                                                                                                           |
| **Alternatives** | • Role on the membership: no room for several accounts or own-account restrictions.<br>• Implicit ownership of one's own account: a minor would have full rights.                                                                                                                           |

---

### CI-5. Account status as fail-safe, with a hold per cause

|                  |                                                                                                                                                                                                                                                                                                                              |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | `account_status` decides whether an account can operate:<br>• Values: `Active`, `Suspended`<br>• Each cause of suspension is an `account_hold`:<br>  ◦ `OperationalSuspension`<br>  ◦ `CustomerRemoved`<br>  ◦ `NoActiveMembership`<br>• `Suspended` exactly when an unreleased hold exists, kept so in the same transaction |
| **Status**       | Accepted · 2026-10-23 · decided by the owner                                                                                                                                                                                                                                                                                 |
| **Context**      | Customer removal, operational suspension, and an `OrganizationOnly` account losing its membership.                                                                                                                                                                                                                           |
| **Rationale**    | • Fail-safe: code that reads only the account still stops it.<br>• Traceability: every cause is kept, with who and when; releasing one never lifts another.                                                                                                                                                                  |
| **Consequences** | The invariant spans rows, so a single use case and a verification test guard it, not a constraint.                                                                                                                                                                                                                           |
| **Examples**     | Acme is suspended for abuse, then removed, then reinstated: it stays `Suspended`.                                                                                                                                                                                                                                            |
| **Alternatives** | • Compute the state at read time: every reader must remember to.<br>• Overwrite the status: causes are lost.                                                                                                                                                                                                                 |
| **Amendments** | 2026-10-24 — moved to the Account subsystem and extended to every account ([AN-3](account.md#an-3-status-and-holds-on-every-account)). |

---

### CI-6. The term Customer

|                  |                                                                                                             |
| :--------------- | :---------------------------------------------------------------------------------------------------------- |
| **Decision**     | A party that does business with the provider is a **Customer**:<br>• an organization, or<br>• an individual |
| **Status**       | Accepted · 2026-10-23 · decided by the owner                                                                |
| **Rationale**    | "Client" means an OAuth client (an application) to IAM readers.                                             |
| **Alternatives** | • Client.<br>• Party: the pattern's name, not a domain term.                                                |

---

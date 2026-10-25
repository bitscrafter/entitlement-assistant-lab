# Account — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | The operational identities of the system: what acts, and what is acted on. |
| **References** | • Model: [`../data-model/account.md`](../data-model/account.md)<br>• Diagram: [`../diagrams/account.svg`](../diagrams/account.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [AN-1](#an-1-one-shared-account-supertype-with-customer-and-internal-subtypes) | One shared account supertype, with customer and internal subtypes |
| [AN-2](#an-2-the-account-category-is-immutable) | The account category is immutable |
| [AN-3](#an-3-status-and-holds-on-every-account) | Status and holds on every account |
| [AN-4](#an-4-internal-identities-act-through-internal-accounts) | Internal identities act through internal accounts |
| [AN-5](#an-5-a-session-acts-as-one-declared-account) | A session acts as one declared account |

---


## Decisions

### AN-1. One shared account supertype, with customer and internal subtypes

| | |
| :--- | :--- |
| **Decision** | Every account is a row of one `account` table:<br>• `account_kind`: `Customer` or `Internal`<br>• `customer_account` and `internal_account` hold what is specific, with composite foreign keys<br>• shared: `account_display_name`, `account_status`, `version`<br>• ids show the kind: `acc_…`, `iac_…`<br>• its own subsystem, Account; identities stay in their subsystems |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Customers and internal identities both act and are acted on. |
| **Rationale** | • Integrity: every `*_by` column becomes a foreign key to one table (CM-13).<br>• Consistency with CI-1 and II-1.<br>• Expandability: a new kind of account is a new kind and subtype. |
| **Related** | • [CI-1](customer-identity.md#ci-1-customer-as-supertype-with-subtype-tables)<br>• [II-1](internal-identity.md#ii-1-internal-identity-as-supertype-with-employee-and-system-kinds)<br>• [CM-13](common.md#cm-13-the-database-enforces-structure-code-enforces-rules) |
| **Alternatives** | Separate customer and internal account tables: every actor reference needs two nullable columns. |

---

### AN-2. The account category is immutable

| | |
| :--- | :--- |
| **Decision** | A customer account's category is an inherent characteristic:<br>• `Standalone`: may hold its own subscription (every organization's account)<br>• `OrganizationMember`: acts only through organization accounts<br>• it never changes; a different category means a different account<br>• one account per customer for now (`UNIQUE (customer_id)`, CM-6) |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Supersedes CI-3, whose operating mode could change. |
| **Rationale** | • Clarity: what an account is does not drift over time.<br>• Fits the shape for many accounts per customer. |
| **Consequences** | An individual with an `OrganizationMember` account who subscribes gets a second, `Standalone` account once the one-account constraint is lifted. |
| **Examples** | Bob, an Acme employee with no subscription, has an `OrganizationMember` account. |
| **Related** | [CI-3](customer-identity.md#ci-3-the-account-is-the-operational-identity) |
| **Alternatives** | A changeable operating mode (CI-3): the same account means different things over time. |

---

### AN-3. Status and holds on every account

| | |
| :--- | :--- |
| **Decision** | The fail-safe of CI-5 applies to every account:<br>• `account_status` on the supertype<br>• `account_hold` per cause: `OperationalSuspension`, `CustomerRemoved`, `NoActiveMembership`, `InternalIdentityInactive`<br>• `Suspended` exactly when an unreleased hold exists |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Extends CI-5 to internal accounts and moves it to the Account subsystem. |
| **Rationale** | A compromised employee or system account is stopped the same way as a customer account. |
| **Consequences** | `NoActiveMembership` is released only by rejoining an organization (the category never changes). |
| **Related** | • [CI-5](customer-identity.md#ci-5-account-status-as-fail-safe-with-a-hold-per-cause)<br>• [AC-6](access.md#ac-6-a-suspended-account-neither-acts-nor-is-changed) |

---

### AN-4. Internal identities act through internal accounts

| | |
| :--- | :--- |
| **Decision** | Employees and system identities act through internal accounts, as customers do through customer accounts:<br>• one account per internal identity for now (`UNIQUE (internal_identity_id)`)<br>• internal role and permission assignments are held by the internal account<br>• attribution names the internal account |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Supersedes II-2 ("employees act as themselves"). |
| **Rationale** | • One model of acting for every actor.<br>• Several accounts per identity (per product scope) need only a dropped constraint. |
| **Related** | • [II-2](internal-identity.md#ii-2-employees-act-as-themselves)<br>• [AC-5](access.md#ac-5-birthright-roles-plus-internal-assignments) |
| **Alternatives** | Employees act as identities (II-2): two models of acting, and no room for several scopes. |

---

### AN-5. A session acts as one declared account

| | |
| :--- | :--- |
| **Decision** | Authentication proves an identity; the session acts as one account:<br>• the account is declared in the authentication request, omitted only when the identity has exactly one<br>• the session token's subject is the account<br>• failure responses never reveal whether the declared account exists or belongs to the identity<br>• switching accounts issues a new token; step-up is a policy per account (designed, not built) |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Identities may have several accounts. |
| **Rationale** | • Security: one account per token limits what a stolen token can do; declaring before authentication avoids choosing after the fact.<br>• Attribution is exact: the token names the actor. |
| **Consequences** | A default-account preference is a production convenience. |
| **Related** | [CM-3](common.md#cm-3-application-sign-in-with-a-stateless-session-token) |
| **Alternatives** | • Choosing the account after authentication: weaker guarantees.<br>• Accounts listed in the token: stale authority, size, disclosure. |
| **Amendments** | 2026-10-25 — the token carries identity only (`sub`, `sid`, `auth_time`); the principal is loaded fresh per decision (CM-16).<br>2026-10-25 — sign-in lives in Account (CM-17). |

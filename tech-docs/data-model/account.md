# Account — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | The operational identities of the system: every actor acts through an account, and every account can be acted on. Customers and internal identities each operate through accounts of their kind, in one shared table. |
| **Status** | Ruled by the owner (2026-10-24) |
| **References** | • Diagram: [`../diagrams/account.er.puml`](../diagrams/account.er.puml) (rendered: [`../diagrams/account.svg`](../diagrams/account.svg))<br>• Decisions: [`../adr/account.md`](../adr/account.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [Entities](#2-entities)
3. [Status and holds](#3-status-and-holds)
4. [Sessions and accounts](#4-sessions-and-accounts)
5. [Invariants](#5-invariants)
6. [Interfaces with other subsystems](#6-interfaces-with-other-subsystems)
7. [Not addressed](#7-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Principal** | The account a decision is made for: always an account, never an identity. |
| **Account** | An operational identity: what acts, and what is acted on. Every attribution, assignment, and `*_by` column names an account, never an identity. |
| **Account kind** | `Customer` (operated by a customer) or `Internal` (operated by an internal identity). |
| **Customer account** | An account operated by a customer: an organization or an individual. |
| **Account category** | An immutable characteristic of a customer account: `Standalone` (may hold its own subscription; every organization's account) or `OrganizationMember` (acts only through organization accounts; never subscribes). |
| **Internal account** | An account operated by an internal identity: an employee or a system identity. |
| **Account status** | `Active` or `Suspended`: the single fail-safe column that decides whether an account can operate. |
| **Account hold** | One cause of suspension, placed at one moment and released at a later one. |

**Ids** show the kind: `acc_…` for customer accounts, `iac_…` for internal accounts.

## 2. Entities

| Entity | Key rules |
| --- | --- |
| `account` | Supertype. `(account_id, account_kind)` is unique, so subtypes can reference the pair. `account_display_name` is shown in the UI and the chat. `version` is the optimistic-concurrency token (`subject_account_version`). Account owns the bump: one conditional statement (`UPDATE account SET version = version + 1 WHERE account_id = $1 AND version = $2`), called by every use case that applies a change to the account, in its own transaction. Preparing or approving a change does not bump it. |
| `customer_account` | Composite foreign keys to `account` (kind `Customer`) and to `customer`. `customer_id` is unique: constrained to one account per customer (CM-6). `(account_id, customer_kind)` is unique, so other subsystems can require an individual's account. Check: an organization's account is `Standalone`. `account_category` never changes; a different category means a different account. |
| `internal_account` | Composite foreign keys to `account` (kind `Internal`) and to `internal_identity`. `internal_identity_id` is unique: constrained to one account per identity (CM-6). `(account_id, identity_kind)` is unique, so Access can match roles to employee or system accounts. |
| `account_hold` | Fact in time (CM-11): `placed_at`, `placed_by`, `released_at`, `released_by`. Never deleted. |

**Creation.** An identity, its subtype rows, and its account are created in one transaction.

## 3. Status and holds

An account is `Suspended` exactly when it has at least one unreleased hold; it then neither acts nor is
the subject of feature actions or changes; employees may still read it (AC-6). Releasing one hold never lifts another.

| Hold reason | Placed when | Released when |
| --- | --- | --- |
| `OperationalSuspension` | an employee suspends the account (abuse, fraud, compromise) | an employee lifts it |
| `CustomerRemoved` | the customer's status becomes `Removed` | the customer is reinstated |
| `NoActiveMembership` | an `OrganizationMember` account's individual loses their active membership | the individual joins an organization again |
| `InternalIdentityInactive` | the internal identity becomes `Suspended` or `Terminated` | the identity becomes `Active` again |

Hold reasons are reason codes in explanations (`account.operational-suspension`, …).

## 4. Sessions and accounts

Authentication proves an identity; a session acts as one account. The sign-in use case lives in Account, because it binds an authenticated identity to an account; it uses Internal Identity's credential check through a port.

| Rule | |
| --- | --- |
| The account is declared in the authentication request. | It may be omitted only when the identity has exactly one account. |
| The session token's subject is the account (`iac_…` for employees). | The token carries identity only: `sub`, `sid` (kept across renewals), `auth_time`, `iat`, `exp`, `jti`. Every decision loads the principal fresh (CM-16). |
| `POST /api/authentication/session/renewal` keeps a session alive. | Past half its lifetime, the principal is re-checked (identity `Active`, account not suspended) and the token re-issued with the same `sid` and `auth_time` and a new `jti`, never beyond 8 hours. Before half-life nothing happens and nothing is recorded. The server closes a WebSocket when its token expires. |
| Failure responses are identical whether or not the identity or the declared account exists, belongs to the identity, is inactive, or is suspended. | No account enumeration before authentication (AU-6). |
| Switching accounts issues a new token. | Step-up authentication is a policy per target account (designed, not built). |

In the demo every employee has one internal account, so the account is never declared.

## 5. Invariants

| Invariant | Guard |
| --- | --- |
| A subtype row's kind matches its account's kind. | composite foreign keys |
| Every account has its subtype row; every identity has its account. | single creation use case, one transaction; verification test over the seeded data |
| An organization's account is `Standalone`. | check constraint |
| `account_category` never changes. | no use case updates it; verification test |
| `account_status = Suspended` exactly when an unreleased hold exists. | single use case that places and releases holds, one transaction; verification test |
| Accounts and holds are never deleted. | no `DELETE` for the application's database role (CM-7) |

## 6. Interfaces with other subsystems

| Subsystem | Relationship |
| --- | --- |
| Customer Identity | Customers operate through customer accounts; customer removal and membership changes place and release holds. |
| Internal Identity | Internal identities operate through internal accounts; identity status changes place and release holds. Account's sign-in asks Internal Identity to check the credential, then binds the session to the account. |
| Access | Account role assignments link customer accounts; internal role and permission assignments are held by internal accounts. |
| Entitlement | Subscriptions belong to `Standalone` customer accounts. |
| Support | Subjects and contacts are customer accounts; assignees are internal accounts. Support calls Account's version bump when it applies a change. |
| Every subsystem | Every `*_by` column references `account` (CM-13). |

## 7. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): several accounts per identity
(declaring, defaulting, and switching between them, with step-up), and workload credentials for system
accounts.

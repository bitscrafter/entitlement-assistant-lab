# Customer Identity — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | Who the provider's customers are and how people relate to organizations. Customers operate through customer accounts, defined in [`account.md`](account.md). |
| **Status** | Ruled by the owner (2026-10-23; accounts moved to the Account subsystem 2026-10-24) |
| **References** | • Diagram: [`../diagrams/customer-identity.er.puml`](../diagrams/customer-identity.er.puml) (rendered: [`../diagrams/customer-identity.svg`](../diagrams/customer-identity.svg))<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [Entities](#2-entities)
3. [Email normalization](#3-email-normalization)
4. [Invariants](#4-invariants)
5. [Interfaces with other subsystems](#5-interfaces-with-other-subsystems)
6. [Decisions](#6-decisions)
7. [Not addressed](#7-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Customer** | A party that does business with the provider. Exactly one of two kinds: **organization** or **individual**. Has a **customer status**: `Active` or `Removed`. Never deleted. |
| **Organization** | A customer that is a company or institution (for example, Acme Corp). It never acts by itself; its members act in its account. |
| **Individual** | A customer that is a person. One person has exactly one individual identity, whether they subscribe on their own, belong to an organization, or both. Individuals never sign in to this application; the product authenticates them, and that is out of scope here. |
| **Organization membership** | The fact that an individual belongs to an organization, from `joined_at` until `ended_at`. Active while not ended. Carries no role. |

**Account context.** Every question about what a person can do is asked of a pair: an acting account
and a target account. Entitlements belong to the target account and never flow between accounts:
Jane's personal Pro plan gives Acme's account nothing, and Acme's Business plan gives Jane's account
nothing.

## 2. Entities

| Entity | Key rules |
| --- | --- |
| `customer` | Supertype of `organization` and `individual`. `customer_kind` names the subtype. `(customer_id, customer_kind)` is unique, so subtypes and customer accounts can reference the pair. |
| `organization` | Keyed by `customer_id`. The composite foreign key `(customer_id, customer_kind)` with `customer_kind = 'Organization'` makes the database refuse an organization row for an individual customer. `primary_domain` is optional and unique, used for lookup only. |
| `individual` | Keyed by `customer_id`, same composite key with `customer_kind = 'Individual'`. `email` is stored normalized (§3) and is unique. The email can change; `customer_id` is the stable identity. |
| `organization_membership` | Its own id (`membership_id`), so leaving, rejoining, and moving to another organization each keep their history. A fact in time (CM-11): `joined_at`, `ended_at`, `end_reason` (`Left`, `Removed`); who ended it is in the audit record (CM-15). At most one active membership per individual (unique index over rows not ended). |

**Shape for many, constrain to one.** One active organization per individual is a unique constraint, not
a table shape (CM-6).

**Creation.** A customer, its subtype row, and its customer account are created in one transaction. The
database guarantees that a subtype *matches* its customer's kind; the single creation use case
guarantees that it *exists*.

## 3. Email normalization

Emails are stored only in normalized form, produced by one function, `normalizeEmail` (CM-10): trim,
Unicode NFC, lowercase, ASCII (punycode) domain, no provider-specific rules. Lookups normalize the same
way. For display, the domain converts back to Unicode.

## 4. Invariants

| Invariant | Guard |
| --- | --- |
| A subtype row's kind matches its customer's kind. | composite foreign key |
| Every customer has its subtype row and its customer account. | single creation use case, one transaction; verification test over the seeded data |
| At most one active organization membership per individual. | partial unique index over rows not ended |
| Customers and memberships are never deleted. | the application's database role has no `DELETE` on these tables |

## 5. Interfaces with other subsystems

| Subsystem | What it relies on here |
| --- | --- |
| Account | Customers operate through customer accounts. A customer's removal places a `CustomerRemoved` hold; losing the last active membership places `NoActiveMembership` on an `OrganizationMember` account. |
| Access | Account role assignments are justified by the same account or an active organization membership (AC-4). |
| Support | A case's contact is an individual's customer account. |
| Attribution | Personal data stays in `individual`; other subsystems store account ids. |

## 6. Decisions

The reasons behind this model are recorded as ADRs in
[`../adr/customer-identity.md`](../adr/customer-identity.md) (CI-1 to CI-6; CI-3 superseded by AN-2),
with the cross-subsystem ones in [`../adr/common.md`](../adr/common.md) (CM-6, CM-7, CM-10, CM-11).

## 7. Not addressed

Concerns a production version would face (several emails per person, verification, invitations,
federation, dependents and guardians, hierarchy, duplicates, removal semantics, personal-data
protection) are listed in [`../production-readiness.md`](../production-readiness.md).

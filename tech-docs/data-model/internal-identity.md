# Internal Identity — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | Every identity that belongs to the provider rather than to a customer: the employees who sign in to this application, and the automated processes that act on their own. |
| **Status** | Ruled by the owner (2026-10-23) |
| **References** | • Diagram: [`../diagrams/internal-identity.er.puml`](../diagrams/internal-identity.er.puml) (rendered: [`../diagrams/internal-identity.svg`](../diagrams/internal-identity.svg))<br>• Decisions: [`../adr/internal-identity.md`](../adr/internal-identity.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [Entities](#2-entities)
3. [Invariants](#3-invariants)
4. [Interfaces with other subsystems](#4-interfaces-with-other-subsystems)
5. [Seeded identities](#5-seeded-identities)
6. [Not addressed](#6-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Internal identity** | An identity that belongs to the provider. Exactly one of two kinds: **employee** or **system identity**. Has an **identity status**: `Active`, `Suspended`, or `Terminated`. Never deleted. |
| **Employee** | A person who works for the provider and signs in to this application. Acts through an internal account ([`account.md`](account.md), AN-4). |
| **System identity** | An automated process that acts on its own (for example, recording the end of an expired grant). Has no credentials: it runs inside the application. |
| **Department** | Where an employee works (`customer-support`). |
| **Job function** | What an employee does (`representative`, `supervisor`). |
| **Job level** | The employee's level within the function: a positive integer whose meaning is defined per function (for representatives, Tier 1 and Tier 2). |
| **CSR** | The everyday name for an employee in the `customer-support` department. Not an entity. |
| **Employee credential** | How an employee proves their identity. Only passwords, stored as PHC strings. |

**Identity status.** Only `Active` identities sign in or act. `Suspended` is temporary (leave, an
investigation, a misbehaving process); `Terminated` is final (an employee who left, a decommissioned
process). The cause of a change is in the audit record.

## 2. Entities

| Entity | Key rules |
| --- | --- |
| `internal_identity` | Supertype. `identity_kind` names the subtype; `(internal_identity_id, identity_kind)` is unique. The id prefix shows the kind: `emp_…` or `sys_…`. |
| `employee` | Keyed by `internal_identity_id`, with the composite foreign key and `identity_kind = 'Employee'`. `email` is normalized (CM-10) and unique. References a department and a job function; `job_level` is greater than zero. |
| `system_identity` | Keyed by `internal_identity_id`, with `identity_kind = 'System'`. `name` is unique and readable (`grant-expiry`). |
| `employee_credential` | References the `employee` subtype, so a system identity can never hold a credential. At most one current credential per employee and kind (a partial unique index over rows not replaced). Replacing a credential sets `replaced_at` and adds a row. |
| `department`, `job_function` | Reference data, seeded. |

**Passwords as PHC strings.** `password_hash` holds the algorithm, its parameters, the salt, and the
hash in one self-describing string: `$pbkdf2-sha256$i=100000$<salt>$<hash>`. Changing parameters or
algorithms needs no schema change, and each password can be re-hashed with stronger settings at the
employee's next sign-in.

## 3. Invariants

| Invariant | Guard |
| --- | --- |
| A subtype row's kind matches its identity's kind. | composite foreign key |
| Every internal identity has its subtype row. | single creation path, one transaction (seeding); verification test over the seeded data |
| Only employees hold credentials. | foreign key to `employee` |
| At most one current credential per employee and kind. | partial unique index |
| Only `Active` identities sign in or act. | sign-in use case; system processes check their own status before acting |
| Internal identities and credentials are never deleted. | no `DELETE` for the application's database role (CM-7) |

## 4. Interfaces with other subsystems

| Subsystem | What it relies on here |
| --- | --- |
| Access | Default roles (birthright access) keyed by department, job function, and job level. Additional roles, and direct permissions with a reason and an expiry, per employee. Designed there. |
| Policy | Conditions can read `jobFunction`, `jobLevel`, and `department` of the principal. |
| Account | Every internal identity operates through one internal account (`iac_…`). An identity becoming `Suspended` or `Terminated` places an `InternalIdentityInactive` hold on it. |
| Attribution | Every action is attributed to an account; the internal account leads to the identity. Designed there. |
| Sign-in | Authenticates employees against their current `Password` credential; the session is then bound to the employee's internal account, which is the token's subject (AN-5). |

## 5. Seeded identities

| Id | Kind | Internal account | Details |
| --- | --- | --- | --- |
| `emp_alex` | Employee | `iac_alex` | Alex · customer-support · representative · level 1 |
| `emp_blair` | Employee | `iac_blair` | Blair · customer-support · representative · level 2 |
| `emp_sam` | Employee | `iac_sam` | Sam · customer-support · supervisor · level 1 |
| `sys_grant_expiry` | System | `iac_sys_grant_expiry` | Records the end of expired grants |
| `sys_approval_process` | System | `iac_sys_approval_process` | Applies or discards change requests when an approval is decided or times out |

Seeding stands in for the employee lifecycle, which is out of scope.

## 6. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): multi-factor authentication and
passkeys, federation with a workforce identity provider, password policy, lockout, the joiner-mover-leaver
lifecycle, access reviews, the link between an employee and their own customer identity, several
internal accounts per identity, and workload credentials for system identities.

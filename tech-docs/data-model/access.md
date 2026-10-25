# Access — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | What an actor holds: roles, permissions, and assignments. Access answers *does this actor hold this permission here?* It is one of the inputs to the **authorization decision** (AU-1), with Account, Entitlement, and Policy. |
| **Status** | Ruled by the owner (2026-10-23) |
| **References** | • Diagram: [`../diagrams/access.er.puml`](../diagrams/access.er.puml) (rendered: [`../diagrams/access.svg`](../diagrams/access.svg))<br>• Decisions: [`../adr/access.md`](../adr/access.md)<br>• Index: [`README.md`](README.md) |


## Contents

1. [Concepts](#1-concepts)
2. [Permissions](#2-permissions)
3. [Roles](#3-roles)
4. [Assignments](#4-assignments)
5. [Effective permissions](#5-effective-permissions)
6. [Invariants](#6-invariants)
7. [Interfaces with other subsystems](#7-interfaces-with-other-subsystems)
8. [Not addressed](#8-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Permission** | One thing that can be done: an operation on a kind of resource, or on one feature. Identified by a readable **permission key**. |
| **Role** | A named bundle of permissions: a capability, not a job. Held by exactly one **principal kind**. |
| **Principal kind** | Which kind of actor can hold a role or permission: `Individual` (an individual's account), `Employee`, or `System`. Organizations never act. |
| **Account role assignment** | A member account holds a role in an account: *`member_account_id` is a member of `member_of_account_id` as `role_key`*. |
| **Birthright role assignment** | A role every employee with given job attributes holds by default: department, job function, and a minimum job level. Reference data, not a per-person row. |
| **Internal role assignment** | An extra role held by an employee or a system identity, with a reason. |
| **Internal permission assignment** | A single permission held directly by an employee or a system identity: the exception, with a reason and an expiry. |
| **Account context** | The account a request acts in. It selects which account role assignment applies: Jane acting in her own account uses her Owner role there; in Acme's account, her Admin role there. |

**Roles give permissions, policies constrain.** Roles and assignments say what an actor *may* do. Policies only
add conditions under which it is refused anyway, or needs approval. A permission no role or assignment
gives is refused, whatever the policies say.

## 2. Permissions

Two patterns:

```text
<resource_type>.<operation>             account.read · subscription.change-plan · approval.decide
feature.<feature_key>.<operation>       feature.sso.configure · feature.api-access.create-token
```

The first names a kind of resource the application manages; its values are fixed here. The second names
one feature from the product catalog; which operations a feature has is defined by the Product subsystem
(`feature_operation`). The pattern follows the resource, not the holder: an individual can hold a
resource permission (`role-assignment.create`).

**Resource operations** (`resource_operation`):

| Resource type | Operations | Held by |
| --- | --- | --- |
| `account` | `read` | Employee |
| `audit` | `read` | Employee |
| `case` | `open` | Employee |
| `case` | `reassign` | Employee (supervisors) |
| `subscription` | `change-plan`, `cancel` | Employee |
| `subscription` | `add-courtesy-term` | Employee |
| `subscription` | `add-complimentary-term` | Employee (designed, not built) |
| `account` | `place-hold`, `release-hold` | Employee (designed, not built) |
| `grant` | `create` | Employee |
| `grant` | `record-expiry` | System |
| `grant` | `revoke` | Employee (explicit early revocation; designed, not built) |
| `approval` | `decide` | Employee |
| `change-request` | `apply` | System |
| `role-assignment` | `create`, `end` | Individual (designed, not built) |
| `subscription` | `request-plan-change`, `request-cancellation` | Individual (a contact asking through support, SU-8) |
| `grant` | `request` | Individual (a contact asking through support, SU-8) |

**Feature operations** (owned by Product):

| Feature | Operations |
| --- | --- |
| `sso` | `configure` |
| `api-access` | `create-token` |
| `audit-log-export` | `export` |
| `advanced-analytics` | `view` |

Both lists are closed: an unknown resource type, feature, or operation is refused when permissions are
loaded.

**The action registry.** Access owns the closed list of every action key: the permission keys above,
plus lifecycle events that are not permissions (`case.set-subject`, `case.close`, `change-request.confirm`,
`approval.expire`, …). Each lifecycle event names the permission that governs it (SU-14): `case.*` by
`case.open`, confirming and canceling a change by its kind's employee permission, `approval.expire` by
`change-request.apply`. Policies, audit records, and the build-time policy check use this registry; an
action key outside it is refused.

## 3. Roles

| Role | Principal kind | Permissions |
| --- | --- | --- |
| `owner` | Individual | every feature permission, `role-assignment.create`, `role-assignment.end`, `subscription.request-plan-change`, `subscription.request-cancellation`, `grant.request` |
| `admin` | Individual | `feature.sso.configure`, `feature.api-access.create-token`, `feature.audit-log-export.export`, `feature.advanced-analytics.view`, `grant.request` |
| `billing` | Individual | `feature.audit-log-export.export`, `feature.advanced-analytics.view`, `subscription.request-plan-change` |
| `viewer` | Individual | `feature.advanced-analytics.view` |
| `support-case-handling` | Employee | `account.read`, `audit.read`, `case.open`, `subscription.change-plan`, `subscription.add-courtesy-term`, `grant.create` |
| `subscription-cancellation` | Employee | `subscription.cancel` |
| `approval-decision` | Employee | `approval.decide` |
| `case-supervision` | Employee | `case.reassign` |
| `entitlement-maintenance` | System | `grant.record-expiry`, `change-request.apply` |

**Birthright role assignments:**

| Department | Job function | Minimum level | Role |
| --- | --- | --- | --- |
| customer-support | representative | 1 | `support-case-handling` |
| customer-support | representative | 2 | `subscription-cancellation` |
| customer-support | supervisor | 1 | `support-case-handling` |
| customer-support | supervisor | 1 | `subscription-cancellation` |
| customer-support | supervisor | 1 | `approval-decision` |
| customer-support | supervisor | 1 | `case-supervision` |

The system identities `sys_grant_expiry` and `sys_approval_process` hold `entitlement-maintenance`
through internal role assignments.

## 4. Assignments

Assignments are facts in time (CM-11): active while not ended (and, for internal assignments, not
expired). Ending one sets `ended_at`, `ended_by`, and `end_reason`; a new assignment is a new row.

| Entity | Key rules |
| --- | --- |
| `account_role_assignment` | The member account belongs to an individual (composite foreign key with `member_customer_kind = 'Individual'`). The role's principal kind is `Individual`. One active row per member, account, and role; several roles per member and account are allowed. `end_reason`: `Revoked` or `MembershipEnded`. |
| `birthright_role_assignment` | Reference data. An employee holds the role when department and job function match and their job level is at least `minimum_job_level`. |
| `internal_role_assignment` | Held by an internal account (an employee's or a system identity's, AN-4); the role's principal kind matches the account's identity kind (shared `principal_kind` column in both foreign keys, to `internal_account (account_id, identity_kind)` and to `role`). Reason required; expiry optional. |
| `internal_permission_assignment` | Same, for one permission. Reason and expiry required. |

`assigned_by` and `ended_by` reference `account` (CM-13). `member_account_id` and `member_of_account_id`
reference `customer_account`.

## 5. Effective permissions

Computed, never stored, by one building block:

| Actor | Effective permissions in an account context |
| --- | --- |
| Individual | the permissions of its active account role assignments in that account |
| Employee (its internal account) | birthright role assignments (from the identity's job attributes) + the account's active internal role and permission assignments |
| System (its internal account) | the account's active internal role and permission assignments |

**The principal is loaded fresh for every decision** (CM-16): roles, assignments, holds, identity status.
Before any of this: a **suspended account can neither act nor be the subject of feature actions or changes** (employees may still read it, AC-6), and only `Active` internal
identities act. Billing problems live in subscriptions, not holds, so an unpaid personal plan never
blocks an individual's work in an organization's account.

## 6. Invariants

| Invariant | Guard |
| --- | --- |
| A role bundles only permissions of its own principal kind. | composite foreign keys on `role_permission` |
| An assignment's role or permission matches its holder's kind. | composite foreign keys |
| Exactly one of `resource_type` and `feature_key` is set on a permission. | check constraint |
| An account role assignment has a justifying relationship: the same account, or an active membership in the organization that owns `member_of_account_id`. | assignment use case; evaluation ignores unjustified assignments; verification test |
| Ending a membership ends the member's assignments in that organization's account, in the same transaction. | membership use case; verification test |
| Internal permission assignments always expire. | `expires_at` not null |

## 7. Interfaces with other subsystems

| Subsystem | Relationship |
| --- | --- |
| Customer Identity | Account role assignments reference accounts; membership justifies them (CI-4). |
| Internal Identity | Birthright role assignments read department, job function, and job level; internal assignments are held by internal accounts (Account). |
| Product | Defines `feature_operation`, which feature permissions reference. |
| Policy | Adds requirements on top of held permissions; unmet outcome `Deny`, or `Conditional` on prerequisites (PO-1). |
| Attribution | Records the actor, the account context, and the role through which a permission was held. |

## 8. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): deny assignments, resource-scoped
roles, delegated administration, access certification, separation-of-duties rules between roles,
just-in-time elevation, and OAuth delegation to client applications.

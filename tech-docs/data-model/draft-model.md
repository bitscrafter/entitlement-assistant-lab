# Data Model — Draft of the Whole Model

|  |  |
| :--- | :--- |
| **Purpose** | This is the model of the system of record (PostgreSQL). The case conversation is not part of it: it lives in each case agent's own SQLite storage (proposal §3). |
| **Status** | Superseded subsystem by subsystem. A subsystem's own document replaces its sections here; the remaining sections are starting points for subsystems not yet designed. See [`README.md`](README.md). |
| **References** | • Diagram: [`../diagrams/data-model.er.puml`](../diagrams/data-model.er.puml) (rendered: [`../diagrams/data-model.svg`](../diagrams/data-model.svg))<br>• Index: [`README.md`](README.md) |

## Contents

1. [The model in one picture](#1-the-model-in-one-picture)
2. [Staff identity](#2-staff-identity)
3. [Customer identity: organization, account, user, membership](#3-customer-identity-organization-account-user-membership)
4. [Authorization: role, permission, role permission](#4-authorization-role-permission-role-permission)
5. [Catalog: feature, plan, add-on, bundles](#5-catalog-feature-plan-add-on-bundles)
6. [Subscriptions and grants](#6-subscriptions-and-grants)
7. [Cases: case, case request, case request approval](#7-cases-case-request-case-request-approval)
8. [Traceability: audit record](#8-traceability-audit-record)
9. [Conventions](#9-conventions)
10. [Questions for the owner](#10-questions-for-the-owner)

---

## 1. The model in one picture

```text
Organization 1 ──── N Account N ──── M User        (through Account Membership, which carries a Role)
                        │
                        ├── 1 Subscription ── 1 Plan ── N Plan Feature Bundle ── Feature
                        │         └── N Subscription Add-on ── Add-on ── N Add-on Feature Bundle ── Feature
                        └── N Entitlement Grant ── 1 Feature

Role N ──── M Permission (through Role Permission);  a Permission may concern one Feature

CSR ── 1 Role,  1 CSR Credential
CSR 1 ── N Case ── N Case Request ── 0..1 Case Request Approval
Audit Record → principal, case, case request
```

**The account is the center of the model.** It is the unit that subscribes, receives grants, and
holds members. Entitlements are computed per account.

## 2. Staff identity

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **CSR** | The identity that signs in to this application. | `email` is unique (case-insensitive). Has exactly one role, whose scope is `Csr`. A `Disabled` CSR cannot sign in. |
| **CSR Credential** | How a CSR proves their identity: a password hash. | Kept apart from the CSR so the identity and the secret have separate lifecycles (rotation; another credential kind later), and so a query that reads a CSR's profile never loads the hash. |

## 3. Customer identity: organization, account, user, membership

> *Your question: an Org and a User may have N Accounts?*

**An organization owns N accounts. A user does not own accounts: a user is a member of N accounts,
and an account has M members.** The membership is its own entity, because it carries the user's role
and status *in that account*.

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **Organization** | The customer company (for example, "Acme Corp"). Groups its accounts. | Every account belongs to exactly one organization. A small customer is an organization with one account. |
| **Account** | The unit that subscribes, receives grants, and holds members. A company may have several (for example, "Acme Production" and "Acme Staging"), each with its own plan. | Has an account status and a `version` that changes on every write to the account, its subscription, or its grants (optimistic concurrency, proposal §9.4). |
| **User** | A person, identified by email, independent of any account. | `email` is unique. A user may belong to accounts of different organizations (a consultant, for example). Users never sign in to this application. |
| **Account Membership** | A user's place in one account: role and status. | Primary key `(account, user)`: one membership per user per account. Exactly one role, whose scope is `AccountMember`. Deactivating a membership removes access to that account only. |

This is the shape most SaaS platforms use, including Cloudflare's own dashboard: users, accounts,
memberships with roles, and organizations that group accounts.

**Consequence for lookup:** "find the account of `jane@acme.com`" can return several accounts. The
assistant then asks the CSR to choose (the `Ambiguous` result already in the Slice 1 spec).

**Seats** are the active memberships of an account. They are counted, never stored.

## 4. Authorization: role, permission, role permission

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **Role** | A named set of permissions. | `role_scope` says who may hold it: `Csr` (Tier1Representative, Tier2Representative, Supervisor) or `AccountMember` (Owner, Admin, Billing, Viewer). A CSR can only hold a `Csr` role, and a membership only an `AccountMember` role. |
| **Permission** | One thing a role may do, named by a key: `account.read`, `grant.create`, `feature.sso.configure`, `feature.api-access.use`. | A feature permission names its feature. `permission_scope` matches `role_scope`, so a member role can never be given a CSR permission. |
| **Role Permission** | Which permissions a role has. | Primary key `(role, permission)`. |

### How this fits with the policy model

This model makes **RBAC the source of what a role may do**, and policies the source of the
**conditions** under which it may not:

1. **Role permissions grant.** No role permission → `Deny`, reason `role-lacks-permission`.
2. **Policies constrain.** A `forbid` or `requireApproval` policy adds conditions: duration, account
   status, Enterprise accounts, and so on.

The proposal's policy model (§7) has policies doing both. This model splits them. See question Q5.

## 5. Catalog: feature, plan, add-on, bundles

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **Feature** | A capability of the product. The unit of entitlement. | `is_paid` (lost when a subscription lapses); `is_metered` (has a limit, for example `seats`). |
| **Plan** | A tier of the product. | `tier_rank` is unique and orders plans, telling an upgrade from a downgrade. |
| **Add-on** | An extension bought on top of a plan. | |
| **Plan Feature Bundle** | One feature a plan includes, with its limit. | Primary key `(plan, feature)`. A null limit means unlimited. |
| **Add-on Feature Bundle** | One feature an add-on includes, with its limit. | Primary key `(add-on, feature)`. |

The catalog is reference data: seeded, versioned with the code, never changed by the assistant.

## 6. Subscriptions and grants

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **Subscription** | The account's current plan and status. | Exactly one per account (unique `account_id`). `past_due_since` is set exactly when the status is `PastDue`. Its history is in the audit records (question Q7). |
| **Subscription Add-on** | An add-on included in a subscription. | Primary key `(subscription, add-on)`. |
| **Entitlement Grant** | One feature given to one account outside its plan, for a limited time. | Always has `expires_at`, later than `starts_at`. Records who granted it, why, and the case request it came from. Revocation is recorded (`revoked_at`, `revoked_by`), never deleted. |

**Effective entitlements** are computed from: subscription → plan bundles, subscription add-ons → add-on
bundles, and active grants. When several sources give the same feature, the entitlement lists all the
sources, and the limit is the highest of them. They are restricted by account status and subscription
status. They are never stored.

## 7. Cases: case, case request, case request approval

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **Case** | One CSR's conversation about one customer matter. | Owned by one CSR. `account_id` is set once the account in focus is known; `caller_user_id` once the caller is identified. The conversation itself lives in the case agent. |
| **Case Request** | A change the CSR asked for in a case: change a plan, grant a feature, … | `request_kind` plus `parameters`. Records the account `version` it was prepared against. Its id is the idempotency key for applying it. Statuses: `AwaitingConfirmation` → `Applied`, `Canceled`, `Refused`, or `AwaitingApproval` → `Applied`, `Refused`, `Expired`. |
| **Case Request Approval** | The supervisor's decision on a case request that policy sent for approval. | At most one per case request. `decided_by` is never the requester (separation of duties). Statuses: `Pending`, `Approved`, `Denied`, `Expired`. |

*Case Request* replaces the proposal's *Proposal*, and *Case Request Approval* replaces *Approval
Request* (question Q8).

## 8. Traceability: audit record

| Entity | Meaning | Key rules |
| --- | --- | --- |
| **Audit Record** | An immutable record of one decision or change. | Append-only: the application's database role has `INSERT` and `SELECT` on it, never `UPDATE` or `DELETE`. `principal_csr_id` is set exactly when `principal_kind` is `Csr`. Carries the reason codes and the policy set version. |

## 9. Conventions

- **Identifiers.** Entities with a lifecycle get prefixed random ids: `csr_…`, `org_…`, `acc_…`, `usr_…`,
  `sub_…`, `grt_…`, `case_…`, `creq_…`. The prefix makes an id's kind visible in logs and chat. Reference
  data uses readable keys: `plan_key = 'Business'`, `feature_key = 'sso'`, `role_key = 'Admin'`.
- **Names.** Tables are singular, `snake_case`. Two tables avoid SQL reserved words: `customer_user`
  (not `user`) and `support_case` (not `case`) (question Q9).
- **Time** is `timestamptz`, in UTC.
- **Enumerations** are PostgreSQL `CHECK` constraints on `text` columns, mirrored by TypeScript union types.

---

## 10. Questions for the owner

Each question has a recommendation; the recommendation is input, not a decision.

**Q1 — Organization, account, user.** Organization 1:N account; user N:M account through membership;
users not owned by an organization.
*Recommendation: as modeled (§3).*

**Q2 — Where entitlements attach.** Options: (a) the account; (b) the organization; (c) both.
*Recommendation: (a). The account is what subscribes. Organization-wide entitlements can come later
without changing (a).*

**Q3 — Roles per membership.** Options: (a) exactly one role per membership; (b) several.
*Recommendation: (a). It keeps explanations simple ("carol is a Viewer"). Several roles can be
added later with a join table.*

**Q4 — One role table or two.** Options: (a) one `role` table with a `role_scope`; (b) separate
`csr_role` and `member_role` tables.
*Recommendation: (a), with the scope enforced by a composite foreign key `(role_key, role_scope)`,
so the database itself refuses a member role on a CSR.*

**Q5 — RBAC grants, policies constrain.** Options: (a) role permissions grant and policies only add
`forbid` / `requireApproval` conditions; (b) policies do both, as in the proposal's §7.
*Recommendation: (a). Each source has one job: "what can a Viewer do?" is answered by one table,
"when is it refused anyway?" by the policy set. This is the common RBAC-plus-ABAC layering.*

**Q6 — Permission granularity.** Feature permissions as `feature.<feature>.<operation>` keys.
*Recommendation: as modeled. The operations are `use` and `configure`.*

**Q7 — Subscription history.** Options: (a) one current subscription per account, with history in
the audit records; (b) a new subscription row per change, with effective dates.
*Recommendation: (a). The scenarios ask "what changed", which the audit records answer. (b) matters
for billing, which is out of scope.*

**Q8 — Case Request.** Options: (a) a case request is a requested **change** only; reads are recorded
in the audit records; (b) every CSR question becomes a case request, reads included.
*Recommendation: (a). A request has a lifecycle (confirm, approve, apply) that reads do not have.*

**Q9 — Names that collide with SQL.** `user` and `case` are reserved words. Options: (a) glossary
terms *User* and *Case*, tables `customer_user` and `support_case`; (b) glossary terms
*Customer User* and *Support Case*, so the code and the tables use the same words.
*Recommendation: (b). "User" alone is ambiguous here, since the CSR is the user of the application.*

**Q10 — Case request parameters.** Options: (a) one `jsonb` column, validated by a TypeScript
discriminated union (one shape per `request_kind`); (b) one table per kind, with foreign keys
(`target_plan_key → plan`).
*Recommendation: (a) for the number of kinds this project has. The domain type is strict; the database
gives up referential integrity on those few fields.*

**Q11 — Policies in the database.** Options: (a) policy files in the repository only, with the version
recorded on each audit record; (b) also seeded into tables.
*Recommendation: (a). Policies are reviewed like code, and nothing queries them by SQL.*

# Access — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | What an actor holds: roles, permissions, and assignments. One input to the authorization decision, with Entitlement and Policy. |
| **References** | • Model: [`../data-model/access.md`](../data-model/access.md)<br>• Diagram: [`../diagrams/access.svg`](../diagrams/access.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [AC-1](#ac-1-rbac-grants-policies-constrain) | RBAC grants, policies constrain |
| [AC-2](#ac-2-roles-are-capability-bundles-held-by-one-principal-kind) | Roles are capability bundles held by one principal kind |
| [AC-3](#ac-3-two-permission-patterns-with-closed-values) | Two permission patterns, with closed values |
| [AC-4](#ac-4-account-role-assignments-justified-by-a-relationship) | Account role assignments, justified by a relationship |
| [AC-5](#ac-5-birthright-roles-plus-internal-assignments) | Birthright roles, plus internal assignments |
| [AC-6](#ac-6-a-suspended-account-neither-acts-nor-is-changed) | A suspended account neither acts nor is changed |
| [AC-7](#ac-7-assignments-are-seeded) | Assignments are seeded |
| [AC-8](#ac-8-the-term-assignment) | The term assignment |

---


## Decisions

### AC-1. RBAC grants, policies constrain

| | |
| :--- | :--- |
| **Decision** | Each question has one source:<br>• Roles and assignments say what an actor may do<br>• Policies only add conditions: forbid, or require approval<br>• A permission no role or assignment gives is refused |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Every authorization decision. Changes the proposal's policy model, where policies both granted and constrained. |
| **Rationale** | • Clarity: "what can a Viewer do?" is one table; "when is it refused anyway?" is the policy set.<br>• The common RBAC-plus-ABAC layering. |
| **Related** | • [CM-4](common.md#cm-4-a-policy-engine-of-our-own-behind-a-port)<br>• [`policy.md`](../data-model/policy.md) |
| **Alternatives** | Policies that both grant and constrain: two places to look for one answer. |
| **Amendments** | 2026-10-25 — wording: policies add requirements whose unmet outcome is `Deny` or `Conditional` on prerequisites (PO-1), not forbid or permit.<br>2026-10-25 — wording: roles give permissions; "grant" is reserved for entitlement grants (AC-8). |

---

### AC-2. Roles are capability bundles held by one principal kind

| | |
| :--- | :--- |
| **Decision** | One `role` table:<br>• A role names a bundle of capabilities, not a job (`support-case-handling`, not `Tier1Representative`)<br>• Each role is held by exactly one principal kind: `Individual`, `Employee`, or `System`<br>• Composite foreign keys keep bundles and assignments within that kind |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Customers, employees, and system processes all hold roles. |
| **Rationale** | • Integrity: the database refuses a customer role with an internal permission, or a system role on an employee.<br>• Clarity: job attributes choose roles; roles never encode jobs. |
| **Consequences** | A role meant for two kinds would be two roles; none is needed. |
| **Related** | [II-3](internal-identity.md#ii-3-department-job-function-and-job-level) |
| **Alternatives** | • Separate customer and internal role tables: two mechanisms for one concept.<br>• High-level kinds (`Account`, `InternalIdentity`): cannot separate employee roles from system roles. |

---

### AC-3. Two permission patterns, with closed values

| | |
| :--- | :--- |
| **Decision** | A permission key follows one of two patterns:<br>• `<resource_type>.<operation>`: values fixed in `resource_operation`<br>• `feature.<feature_key>.<operation>`: values defined by Product (`feature_operation`), one concrete verb per feature |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Resource types are fixed by the application; features are catalog data that grows. |
| **Rationale** | • Readability: a permission reads as what it allows (`feature.api-access.create-token`).<br>• Integrity: unknown values are refused at load time. |
| **Consequences** | The pattern follows the resource, not the holder: an individual can hold `role-assignment.create`. |
| **Examples** | `account.read`, `approval.decide`, `feature.sso.configure` |
| **Alternatives** | • One pattern with an optional instance: hides the difference between fixed and catalog values.<br>• Generic verbs (`use`): vague in explanations. |
| **Amendments** | 2026-10-25 — resource operations gain `account.place-hold`, `account.release-hold` (employees, designed), `grant.revoke` (employees, explicit early revocation, designed), and `grant.record-expiry` (system, replacing the system's `grant.revoke`).<br>2026-10-25 — new permission `case.reassign` (employees; held by supervisors). The registry of all action keys, permissions and lifecycle events, lives in Access, next to `resource_operation`. |

---

### AC-4. Account role assignments, justified by a relationship

| | |
| :--- | :--- |
| **Decision** | `member_account_id` is a member of `member_of_account_id` as `role_key`:<br>• The member account is an individual's<br>• Several roles per member and account are allowed<br>• Each needs a justifying relationship: the same account, or an active membership in the organization that owns the account<br>• Ending a membership ends its assignments in the same transaction |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Customer side; refines CI-4. |
| **Rationale** | • One rule for own accounts and organization accounts.<br>• Fail-safe: assignments end with the membership, and evaluation ignores unjustified ones. |
| **Examples** | `acc_jane` member of `acc_jane` as Owner; `acc_jane` member of `acc_acme` as Admin and Billing. |
| **Related** | • [CI-4](customer-identity.md#ci-4-roles-live-in-access-on-accounts)<br>• [CM-11](common.md#cm-11-status-for-lifecycles-timestamps-for-facts) |
| **Alternatives** | One role per member and account: Jane could not be both Admin and Billing. |

---

### AC-5. Birthright roles, plus internal assignments

| | |
| :--- | :--- |
| **Decision** | An employee's permissions come from three sources:<br>• Birthright role assignments: department, job function, and a minimum job level select default roles; higher levels add roles<br>• Internal role assignments: extra roles, reason required, expiry optional<br>• Internal permission assignments: the exception, reason and expiry required |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Internal side. System identities hold roles through internal assignments only. |
| **Rationale** | • Default access follows the job without per-person setup.<br>• Exceptions are justified and end on their own. |
| **Consequences** | Customization only adds; removing a default permission needs deny assignments, listed in `production-readiness.md`. |
| **Examples** | A level-2 Representative holds `support-case-handling` and `subscription-cancellation`. |
| **Related** | [II-3](internal-identity.md#ii-3-department-job-function-and-job-level) |
| **Alternatives** | Exact-level birthright rows: each level repeats the roles of the levels below. |
| **Amendments** | 2026-10-24 — internal role and permission assignments are held by internal accounts ([AN-4](account.md#an-4-internal-identities-act-through-internal-accounts)). |

---

### AC-6. A suspended account neither acts nor is changed

| | |
| :--- | :--- |
| **Decision** | Before any permission is evaluated:<br>• a `Suspended` account cannot act anywhere<br>• a `Suspended` account cannot be acted on<br>• only `Active` internal identities act |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | An individual's account is its operational identity (CI-3). |
| **Rationale** | Holds mean abuse, removal, or lost membership, which should stop an actor everywhere. |
| **Consequences** | Billing problems live in subscriptions, not holds: an unpaid personal plan never blocks work in an organization's account. |
| **Related** | [CI-5](customer-identity.md#ci-5-account-status-as-fail-safe-with-a-hold-per-cause) |
| **Amendments** | 2026-10-24 — a suspended account cannot act, and cannot be the subject of feature actions or changes; employees may still read it (`account.read`, `audit.read`), so support can explain the suspension.<br>2026-10-25 — terminating actions (end, expire, cancel, record) on a suspended subject are allowed; a suspended contact cannot ask for changes. |

---

### AC-7. Assignments are seeded

| | |
| :--- | :--- |
| **Decision** | Roles, permissions, and assignments are seeded:<br>• No administration in the application<br>• Managing assignments is itself a permission (`role-assignment.create`, `role-assignment.end`), designed but not built |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | The demo reads access; it does not administer it. |
| **Consequences** | The stretch scenario that changes a member's role would be the first use. |

---

### AC-8. The term assignment

| | |
| :--- | :--- |
| **Decision** | Access uses **assignment** for every way a role or permission is held:<br>• account role assignment<br>• birthright role assignment<br>• internal role assignment<br>• internal permission assignment |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Rationale** | "Grant" means an entitlement grant; one word, one meaning. |
| **Alternatives** | Grant: already taken by Entitlement. |

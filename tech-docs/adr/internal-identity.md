# Internal Identity — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | Every identity that belongs to the provider: the employees who sign in to this application, and the automated processes that act on their own. |
| **References** | • Model: [`../data-model/internal-identity.md`](../data-model/internal-identity.md)<br>• Diagram: [`../diagrams/internal-identity.svg`](../diagrams/internal-identity.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [II-1](#ii-1-internal-identity-as-supertype-with-employee-and-system-kinds) | Internal identity as supertype with employee and system kinds |
| [II-2](#ii-2-employees-act-as-themselves) | Employees act as themselves |
| [II-3](#ii-3-department-job-function-and-job-level) | Department, job function, and job level |
| [II-4](#ii-4-employee-credentials-in-their-own-table-as-phc-strings) | Employee credentials in their own table, as PHC strings |
| [II-5](#ii-5-identity-status-without-holds) | Identity status without holds |
| [II-6](#ii-6-internal-and-customer-identities-are-separate) | Internal and customer identities are separate |

---


## Decisions

### II-1. Internal identity as supertype with employee and system kinds

| | |
| :--- | :--- |
| **Decision** | Every identity that belongs to the provider is an `internal_identity`:<br>• `identity_kind`: `Employee` or `System`<br>• `employee` and `system_identity` hold what is specific, keyed by `internal_identity_id`, with a composite foreign key `(internal_identity_id, identity_kind)`<br>• The id prefix shows the kind: `emp_…`, `sys_…` |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Employees sign in and act; automated processes act without signing in. Both must be attributable. |
| **Rationale** | • Attribution: automated actions name *which* process acted, never a person.<br>• Consistency: the same pattern as customers (CI-1).<br>• Operability: a misbehaving process is stopped through its status. |
| **Consequences** | • Attribution has two principal kinds: account (customers) and internal identity.<br>• System identities are seeded rows; adding one is data, not code structure. |
| **Related** | [CI-1](customer-identity.md#ci-1-customer-as-supertype-with-subtype-tables) |
| **Alternatives** | • A fixed `System` principal with no table: "the system did it" is weak attribution.<br>• System identities as their own subsystem: more structure for a few rows. |
| **Amendments** | 2026-10-25 — superseded consequence: attribution always names an account (AN-4); internal identities act through internal accounts. |

---

### II-2. Employees act as themselves

| | |
| :--- | :--- |
| **Decision** | An employee is the actor of their own actions:<br>• No employee account<br>• Attribution names the `internal_identity_id` |
| **Status** | Superseded by AN-4 · 2026-10-23 · decided by the owner |
| **Context** | Customers act through accounts (CI-3). Employees hold no subscriptions and work in one product. |
| **Rationale** | • Simplicity: no scope to add to every check.<br>• An opaque id keeps personal data out of logs, as an account id does. |
| **Consequences** | Operating across several products would need a scope per employee; listed in `production-readiness.md`. |
| **Related** | [CI-3](customer-identity.md#ci-3-the-account-is-the-operational-identity) |
| **Alternatives** | Employee accounts per product scope: more scalable, adds a scope to every authorization check. |

---

### II-3. Department, job function, and job level

| | |
| :--- | :--- |
| **Decision** | An employee's job is described by three attributes instead of one combined role:<br>• Department: `customer-support` (reference table)<br>• Job function: `representative`, `supervisor` (reference table)<br>• Job level: a positive integer, meaning defined per function |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | A value such as `Tier1Representative` mixed a level and a function. |
| **Rationale** | • Clarity: each attribute means one thing.<br>• Policies read attributes directly (`principal.jobLevel >= 2`).<br>• Default roles key on the three attributes (birthright access). |
| **Consequences** | • Roles are permission bundles in Access, not job descriptions.<br>• "CSR" is the everyday name for a customer-support employee, not an entity. |
| **Examples** | Alex: customer-support · representative · level 1. Sam: customer-support · supervisor · level 1. |
| **Alternatives** | • One combined value (`Tier1Representative`): two concepts in one.<br>• Reporting lines and teams: nothing in the scenarios needs them. |
| **Amendments** | 2026-10-25 — attribute names are `principal.job_level`, `principal.job_function` (snake case, the policy schema). |

---

### II-4. Employee credentials in their own table, as PHC strings

| | |
| :--- | :--- |
| **Decision** | Credentials live in `employee_credential`, one row per credential:<br>• Only employees hold credentials (foreign key to `employee`)<br>• At most one current credential per employee and kind<br>• `password_hash` is a PHC string: algorithm, parameters, salt, and hash in one value |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Employees sign in with a password (CM-3). |
| **Rationale** | • Security: profile reads never load the hash.<br>• Evolvability: new credential kinds add rows (CM-6); new hashing parameters need no schema change.<br>• History: replaced credentials are kept. |
| **Consequences** | Passwords can be re-hashed with stronger settings at the next sign-in. |
| **Examples** | `$pbkdf2-sha256$i=100000$<salt>$<hash>` |
| **Alternatives** | • Hash columns on the employee: one credential only, hash loaded with the profile.<br>• Separate columns for salt, iterations, and algorithm: a schema change per algorithm. |

---

### II-5. Identity status without holds

| | |
| :--- | :--- |
| **Decision** | `identity_status` is `Active`, `Suspended`, or `Terminated`:<br>• Only `Active` identities sign in or act<br>• `Terminated` is final<br>• The cause of each change is in the audit record |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Status changes for internal identities are rare and made by few people. |
| **Rationale** | Simplicity: one cause at a time is the normal case. |
| **Related** | [CI-5](customer-identity.md#ci-5-account-status-as-fail-safe-with-a-hold-per-cause) |
| **Alternatives** | Holds per cause, as for accounts: consistent, more structure than the need. |

---

### II-6. Internal and customer identities are separate

| | |
| :--- | :--- |
| **Decision** | An employee who is also a customer has two identities:<br>• one internal identity<br>• one customer identity<br>• no shared person table |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Workforce and customer identities have different lifecycles, trust, and (in production) identity providers. |
| **Rationale** | Separation of domains: a change in one never alters the other. |
| **Consequences** | Linking the two (for a conflict-of-interest policy) is desirable; listed in `production-readiness.md`. |
| **Related** | [CI-2](customer-identity.md#ci-2-one-identity-per-person-membership-is-a-relationship) |
| **Alternatives** | One person table for both: couples two domains with different rules. |

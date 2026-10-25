# Architecture Decision Records

|  |  |
| :--- | :--- |
| **Purpose** | Why the system is the way it is. One file per subsystem, plus `common.md` for decisions that touch more than one subsystem. Ids carry their file's prefix and never change. |
| **Status** | Living index: every record, its status, and its date |
| **References** | • Proposal: [`../entitlement-agent-proposal.md`](../entitlement-agent-proposal.md)<br>• Data model: [`../data-model/README.md`](../data-model/README.md) |

| Prefix | File |
| --- | --- |
| `CM` | [`common.md`](common.md) |
| `CI` | [`customer-identity.md`](customer-identity.md) |
| `II` | [`internal-identity.md`](internal-identity.md) |
| `AN` | [`account.md`](account.md) |
| `AC` | [`access.md`](access.md) |
| `PR` | [`product.md`](product.md) |
| `EN` | [`entitlement.md`](entitlement.md) |
| `SU` | [`support.md`](support.md) |
| `AT` | [`attribution.md`](attribution.md) |
| `PO` | [`policy.md`](policy.md) |
| `AU` | [`authorization.md`](authorization.md) |

## Template

Each file starts with a front-matter table (**Purpose**, **References**: for example, the model and its diagram)
and a **Contents** table (number and name, linked). Each record is an H3 heading with its number and name, followed by
a two-column, left-aligned table with an empty header row: the field on the left, the text on the
right. **Decision** comes first: a sentence for what is common, then bullets for the specifics, indented
where a point has its own details. Other fields with several points keep them in one row, as bullets
separated by `<br>`. Fields with nothing to say are left out. Records are separated by a horizontal rule. Every table, References included, starts with an empty
header row, because a filled first row renders centered and bold. Entries in **Related** are links.

```markdown
### XX-n. <Name>

|  |  |
| :--- | :--- |
| **Decision** | <what is common>:<br>• <specific><br>• <specific with details>:<br>  ◦ <detail><br>  ◦ <detail> |
| **Status** | Proposed, Accepted, or Superseded by XX-m · <date> · decided by <who> |
| **Context** | what, when, why, where it applies |
| **Rationale** | • how one quality attribute is affected<br>• how another is affected |
| **Consequences** | what becomes easier, what becomes harder, follow-ups |
| **Examples** | … |
| **Related** | • [XX-m](#xx-m-name) (same file) or [YY-k](other-file.md#yy-k-name)<br>• [`document`](../path/to/document.md) |
| **Alternatives** | • one alternative: why not<br>• another alternative: why not |
| **Amendments** | <date> — <clarification or extension> |

---
```

Indentation uses two em spaces (U+2003) before `◦`. Keep each record short. An amendment may clarify
or extend a decision; a change of decision is a new ADR, and the old one becomes `Superseded by` it.

## Index

| Id | Title | Status | Date |
| --- | --- | --- | --- |
| CM-1 | Hexagonal and clean architecture | Accepted | 2026-10-22 |
| CM-2 | PostgreSQL through Hyperdrive as system of record | Accepted | 2026-10-22 |
| CM-3 | Application sign-in with a stateless session token | Accepted | 2026-10-22 |
| CM-4 | A policy engine of our own, behind a port | Accepted | 2026-10-22 |
| CM-5 | The LLM proposes; the policy engine decides | Accepted | 2026-10-22 |
| CM-6 | Shape for many, constrain to one | Accepted | 2026-10-23 |
| CM-7 | Never delete identities or history | Accepted | 2026-10-23 |
| CM-8 | One email normalization | Superseded by CM-10 | 2026-10-23 |
| CM-9 | Authorization freshness by sensitivity | Superseded by CM-16 | 2026-10-23 |
| CM-10 | Store only the normalized email | Accepted | 2026-10-23 |
| CM-11 | Status for lifecycles, timestamps for facts | Accepted | 2026-10-23 |
| CM-12 | Kebab-case keys for reference data | Accepted | 2026-10-23 |
| CM-13 | The database enforces structure; code enforces rules | Accepted | 2026-10-24 |
| CM-14 | UUIDv7 ids, stored natively, shown with a prefix | Accepted | 2026-10-24 |
| CI-1 | Customer as supertype with subtype tables | Accepted | 2026-10-23 |
| CI-2 | One identity per person; membership is a relationship | Accepted | 2026-10-23 |
| CI-3 | The account is the operational identity | Superseded by AN-2 | 2026-10-23 |
| CI-4 | Roles live in Access, on accounts | Accepted | 2026-10-23 |
| CI-5 | Account status as fail-safe, with a hold per cause | Accepted | 2026-10-23 |
| CI-6 | The term Customer | Accepted | 2026-10-23 |
| II-1 | Internal identity as supertype with employee and system kinds | Accepted | 2026-10-23 |
| II-2 | Employees act as themselves | Superseded by AN-4 | 2026-10-23 |
| II-3 | Department, job function, and job level | Accepted | 2026-10-23 |
| II-4 | Employee credentials in their own table, as PHC strings | Accepted | 2026-10-23 |
| II-5 | Identity status without holds | Accepted | 2026-10-23 |
| II-6 | Internal and customer identities are separate | Accepted | 2026-10-23 |
| AC-1 | RBAC grants, policies constrain | Accepted | 2026-10-23 |
| AC-2 | Roles are capability bundles held by one principal kind | Accepted | 2026-10-23 |
| AC-3 | Two permission patterns, with closed values | Accepted | 2026-10-23 |
| AC-4 | Account role assignments, justified by a relationship | Accepted | 2026-10-23 |
| AC-5 | Birthright roles, plus internal assignments | Accepted | 2026-10-23 |
| AC-6 | A suspended account neither acts nor is changed | Accepted | 2026-10-23 |
| AC-7 | Assignments are seeded | Accepted | 2026-10-23 |
| AC-8 | The term assignment | Accepted | 2026-10-23 |
| PR-1 | A product table; features belong to one product | Accepted | 2026-10-23 |
| PR-2 | Plans and add-ons are independent of products | Accepted | 2026-10-23 |
| PR-3 | Plan ladders rank plans | Accepted | 2026-10-23 |
| PR-4 | Plan-feature bundles are the only source of what a plan includes | Accepted | 2026-10-23 |
| PR-5 | Paid, metered unit, and quota | Superseded by PR-8 | 2026-10-23 |
| PR-6 | Add-ons only where they add something | Accepted | 2026-10-23 |
| PR-7 | The catalog is seeded; pricing is out of scope | Accepted | 2026-10-23 |
| PR-8 | Metered unit and quota | Accepted | 2026-10-23 |
| EN-1 | A subscription is Active or Canceled | Superseded by EN-9 | 2026-10-23 |
| EN-2 | Plan and add-ons are facts in time | Superseded by EN-10 | 2026-10-23 |
| EN-3 | Access periods control the whole subscription | Superseded by EN-10 | 2026-10-23 |
| EN-4 | Grants only where they add something | Accepted | 2026-10-23 |
| EN-5 | Grant expiry is fail-safe twice | Accepted | 2026-10-23 |
| EN-6 | Effective entitlements are computed by one building block | Accepted | 2026-10-23 |
| EN-7 | Seats in use are counted from role assignments | Accepted | 2026-10-23 |
| EN-8 | Plan changes end add-ons that no longer fit | Accepted | 2026-10-23 |
| SU-1 | Case ownership through assignments | Accepted | 2026-10-23 |
| SU-2 | One subject account per case, and a separate contact | Accepted | 2026-10-23 |
| SU-3 | Change requests, for changes only | Accepted | 2026-10-23 |
| SU-4 | Confirming applies exactly what was shown | Accepted | 2026-10-23 |
| SU-5 | Every change request ends in a final status | Accepted | 2026-10-23 |
| SU-6 | Approvals in their own table, with a durable timer | Accepted | 2026-10-23 |
| SU-7 | The conversation stays in the agent; the summary in the database | Accepted | 2026-10-23 |
| SU-8 | A customer-requested change needs two permissions | Accepted | 2026-10-24 |
| AN-1 | One shared account supertype, with customer and internal subtypes | Accepted | 2026-10-24 |
| AN-2 | The account category is immutable | Accepted | 2026-10-24 |
| AN-3 | Status and holds on every account | Accepted | 2026-10-24 |
| AN-4 | Internal identities act through internal accounts | Accepted | 2026-10-24 |
| AN-5 | A session acts as one declared account | Accepted | 2026-10-24 |
| AT-1 | Audit records, traces, and logs are distinct | Accepted | 2026-10-24 |
| AT-2 | One actor, plus participants | Accepted | 2026-10-24 |
| AT-3 | Every decision and change is audited, or it does not happen | Accepted | 2026-10-24 |
| AT-4 | A keyed hash chain makes alteration detectable | Accepted | 2026-10-24 |
| AT-5 | Action keys, outcomes, and reasons | Accepted | 2026-10-24 |
| AT-6 | Trace and session correlation | Accepted | 2026-10-24 |
| AT-7 | No personal data in the audit | Accepted | 2026-10-24 |
| PO-1 | Policies are requirements in positive form | Accepted | 2026-10-24 |
| PO-2 | Deny wins, then Conditional | Accepted | 2026-10-24 |
| PO-3 | Prerequisites are fulfilled through attributes | Accepted | 2026-10-24 |
| PO-4 | CEL predicates over a closed attribute schema | Accepted | 2026-10-24 |
| PO-5 | Files are the source; loaded sets are immutable | Accepted | 2026-10-24 |
| PO-6 | Policy cases are data, outside the policy files | Accepted | 2026-10-24 |
| AU-1 | The decision is a chain of responsibility | Accepted | 2026-10-24 |
| AU-2 | Findings and decisions | Accepted | 2026-10-24 |
| AU-3 | Default deny lives in the access step | Accepted | 2026-10-24 |
| CM-15 | Foreign keys point down the layer order | Accepted | 2026-10-25 |
| CM-16 | The session token carries identity only | Accepted | 2026-10-25 |
| EN-9 | A subscription is a fact in time | Accepted | 2026-10-25 |
| EN-10 | Subscription terms: one timeline of plan and coverage | Accepted | 2026-10-25 |
| PR-9 | Plans have a category | Accepted | 2026-10-25 |
| PR-10 | Remedies name a plan and eligible add-ons | Accepted | 2026-10-25 |
| SU-9 | Case lifecycle steps are use cases, confirmed outside the LLM | Accepted | 2026-10-25 |
| SU-10 | Contacts are authenticated | Accepted | 2026-10-25 |
| SU-11 | Applying an approved change re-runs the decision | Superseded by SU-15 | 2026-10-25 |
| SU-12 | Supervisors decide approvals outside the chat | Accepted | 2026-10-25 |
| SU-13 | Stale change requests are canceled; refusals are audited on their own | Accepted | 2026-10-25 |
| AU-4 | Every use case touching a subject passes the account.read gate | Accepted | 2026-10-25 |
| AU-5 | The PDP and PIP live in Authorization; PEPs are use cases | Accepted | 2026-10-25 |
| AU-6 | Refusals reveal nothing beyond what a legitimate principal may know | Accepted | 2026-10-25 |
| SU-14 | Case actions require the case's assignee | Accepted | 2026-10-25 |
| SU-15 | Applying an approved change re-runs the confirmer's decision against what was shown | Accepted | 2026-10-25 |
| CM-17 | Authorization and attribution are reached through shared ports | Accepted | 2026-10-25 |

The Access records were created as `AZ-1` to `AZ-8` and renamed `AC-1` to `AC-8` with their subsystem
on 2026-10-23, before anything outside these documents referred to them.

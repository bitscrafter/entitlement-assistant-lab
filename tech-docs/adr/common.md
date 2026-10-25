# Common — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | Decisions that touch more than one subsystem. |
| **References** | • Architecture: [`../../AI_AS_ARCHITECT.md`](../../AI_AS_ARCHITECT.md)<br>• Proposal: [`../entitlement-assistant-proposal.md`](../entitlement-assistant-proposal.md)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number                                                           | Name                                               |
| :--------------------------------------------------------------- | :------------------------------------------------- |
| [CM-1](#cm-1-hexagonal-and-clean-architecture)                   | Hexagonal and clean architecture                   |
| [CM-2](#cm-2-postgresql-through-hyperdrive-as-system-of-record)  | PostgreSQL through Hyperdrive as system of record  |
| [CM-3](#cm-3-application-sign-in-with-a-stateless-session-token) | Application sign-in with a stateless session token |
| [CM-4](#cm-4-a-policy-engine-of-our-own-behind-a-port)           | A policy engine of our own, behind a port          |
| [CM-5](#cm-5-the-llm-proposes-the-policy-engine-decides)         | The LLM proposes; the policy engine decides        |
| [CM-6](#cm-6-shape-for-many-constrain-to-one)                    | Shape for many, constrain to one                   |
| [CM-7](#cm-7-never-delete-identities-or-history)                 | Never delete identities or history                 |
| [CM-8](#cm-8-one-email-normalization)                            | One email normalization                            |
| [CM-9](#cm-9-authorization-freshness-by-sensitivity)             | Authorization freshness by sensitivity             |
| [CM-10](#cm-10-store-only-the-normalized-email) | Store only the normalized email |
| [CM-11](#cm-11-status-for-lifecycles-timestamps-for-facts) | Status for lifecycles, timestamps for facts |
| [CM-12](#cm-12-kebab-case-keys-for-reference-data) | Kebab-case keys for reference data |
| [CM-13](#cm-13-the-database-enforces-structure-code-enforces-rules) | The database enforces structure; code enforces rules |
| [CM-14](#cm-14-uuidv7-ids-stored-natively-shown-with-a-prefix) | UUIDv7 ids, stored natively, shown with a prefix |
| [CM-15](#cm-15-foreign-keys-point-down-the-layer-order) | Foreign keys point down the layer order |
| [CM-16](#cm-16-the-session-token-carries-identity-only) | The session token carries identity only |
| [CM-17](#cm-17-authorization-and-attribution-are-reached-through-shared-ports) | Authorization and attribution are reached through shared ports |

---


## Decisions

### CM-1. Hexagonal and clean architecture

|                  |                                                                                                                                                                                                                                                                                                     |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Code is organized as ports and adapters, with dependencies pointing inward:<br>• Domain: pure rules, no I/O<br>• Application: use cases and the ports they need<br>• Adapters: the only code that touches Cloudflare, PostgreSQL, or the LLM<br>• Composition: wires adapters into each entry point |
| **Status**       | Accepted · 2026-10-22 · decided by the owner                                                                                                                                                                                                                                                        |
| **Context**      | All code in `system/`.                                                                                                                                                                                                                                                                              |
| **Rationale**    | • Testability: the domain and use cases run without Cloudflare or PostgreSQL.<br>• Replaceability: an adapter is swapped without touching rules.<br>• The LLM stays one adapter among others.                                                                                                       |
| **Consequences** | • Every side effect needs a port.<br>• Layering is enforced by dependency-cruiser in the GREEN gate.                                                                                                                                                                                                |
| **Related**      | [`AI_AS_ARCHITECT.md`](../../AI_AS_ARCHITECT.md)                                                                                                                                                                                                                                                                                |
| **Alternatives** | • Framework-centric layering: rules leak into handlers.<br>• A single module: fast to start, untestable at scale.                                                                                                                                                                                   |
| **Amendments** | 2026-10-24 — the structure is subsystems as modules, each hexagonal inside (`model` ← `usecase` ← `infra`), with shared `port/`, `adapter/`, `external/`, and one application holding the bootstrap; subsystems meet only through public use cases and ports (`AI_AS_ARCHITECT.md` §1). |

---

### CM-2. PostgreSQL through Hyperdrive as system of record

|                  |                                                                                                                                                                                                           |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | PostgreSQL is the system of record, reached from Workers through Hyperdrive:<br>• It holds customers, entitlements, cases, and audit records<br>• The case conversation stays in each agent's own storage |
| **Status**       | Accepted · 2026-10-22 · decided by the owner                                                                                                                                                              |
| **Context**      | The system of record for every subsystem. The case conversation lives in agent storage instead.                                                                                                           |
| **Rationale**    | • Integrity and idempotency through transactions and constraints.<br>• Familiar to reviewers; listed by the target role.                                                                                  |
| **Consequences** | A hosted PostgreSQL for the deployed demo, a local one for development.                                                                                                                                   |
| **Alternatives** | • D1: simpler on Cloudflare, SQLite dialect.<br>• A Durable Object per account: consistent per account, hard to query across accounts.                                                                    |

---

### CM-3. Application sign-in with a stateless session token

|                  |                                                                                                                                                                                                                                                          |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | The application authenticates employees itself:<br>• Pre-seeded employees sign in with a password<br>• A signed JWT is issued as the session token<br>• It travels in an `HttpOnly; Secure; SameSite=Strict` cookie<br>• It is verified on every request |
| **Status**       | Accepted · 2026-10-22 · decided by the owner                                                                                                                                                                                                             |
| **Context**      | Authentication of the only users of the application: employees (CSRs).                                                                                                                                                                                   |
| **Rationale**    | • Security: scripts cannot read the token; it works on WebSocket upgrades, which cannot carry headers.<br>• Simplicity: no session store.<br>• Reviewers sign in with demo credentials.                                                                  |
| **Consequences** | • A token cannot be revoked before it expires, so its lifetime is short.<br>• Lifetimes are set by the employee-sign-in feature spec.                                                                                                                        |
| **Related**      | • [CM-9](#cm-9-authorization-freshness-by-sensitivity)<br>• [`sign-in.sequence.puml`](../diagrams/sign-in.sequence.puml)                                                                                                                                                                                                          |
| **Alternatives** | • Cloudflare Access: Cloudflare authenticates; reviewers must join a Zero Trust organization.<br>• Bearer token in script storage: exposed to XSS, unusable on WebSocket upgrades.                                                                       |
| **Amendments** | 2026-10-24 — the token's subject is the account the session acts as, declared at authentication when the identity has several ([AN-5](account.md#an-5-a-session-acts-as-one-declared-account)).<br>2026-10-25 — wording: the browser `WebSocket` API cannot add an `Authorization` header to the upgrade request (the upgrade does carry the cookie). |

---

### CM-4. A policy engine of our own, behind a port

|                  |                                                                                                                                                            |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Authorization decisions come from a Policy Decision Point:<br>• A small typed evaluator written for this project<br>• Behind a port, so it can be replaced |
| **Status**       | Accepted · 2026-10-22 · decided by the owner                                                                                                               |
| **Context**      | Every use case asks the PDP before acting.                                                                                                                 |
| **Rationale**    | • Explainability: decisions carry reason codes.<br>• No external dependency; replaceable behind the port.                                                  |
| **Consequences** | The condition language is designed in the Policy subsystem.                                                                                                |
| **Alternatives** | Cedar: a candidate replacement behind the same port.                                                                                                       |

---

### CM-5. The LLM proposes; the policy engine decides

|                  |                                                                                                                                                                                                                                                  |
| :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | The LLM only selects tools and arguments; everything else is decided outside it:<br>• The principal comes from the verified session<br>• Every tool call is authorized by the PDP<br>• Every state change needs the CSR's confirmation in the UI |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context**      | All assistant tools.                                                                                                                                                                                                                             |
| **Rationale**    | Security: a prompt injection can change what the LLM says, never what the system allows.                                                                                                                                                         |
| **Consequences** | Tools return structured results with reason codes; the LLM phrases them.                                                                                                                                                                         |
| **Related**      | • [CM-4](#cm-4-a-policy-engine-of-our-own-behind-a-port)<br>• [Proposal](../entitlement-assistant-proposal.md) §2 and §6                                                                                                                                                                                                                   |
| **Amendments** | 2026-10-25 — the principle holds across the accepted design (AU-1, SU-4, PO-1); its status awaits the owner's ruling.<br>2026-10-25 — accepted with a wording precision: every change to a customer account is a change request the CSR confirms in the UI; case steps (setting the contact, recording contact authentication, closing) are CSR actions in the UI, never triggered by the LLM alone.<br>2026-10-25 — every effect on a customer traces back to a person's click: the CSR's confirmation, and a supervisor's approval where a policy requires one. Other writes (audit records, prepared change requests, conversation storage, recorded expiries) change nothing a customer has. |

---

### CM-6. Shape for many, constrain to one

|               |                                                                                                                           |
| :------------ | :------------------------------------------------------------------------------------------------------------------------ |
| **Decision**  | Where a relationship is limited to one for simplicity:<br>• the tables are shaped for many<br>• a constraint enforces one |
| **Status**    | Accepted · 2026-10-23 · decided by the owner                                                                              |
| **Context**   | All subsystems.                                                                                                           |
| **Rationale** | Evolvability: table structure and relationships are costly to change in production; dropping a constraint is not.         |
| **Examples**  | • One account per customer: `UNIQUE (customer_id)`.<br>• One active organization per individual: a partial unique index.  |

---

### CM-7. Never delete identities or history

|                  |                                                                                                                                                                  |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | Records that history refers to are never deleted:<br>• Identities, memberships, holds, and the like<br>• Removal is a status<br>• Ending is a timestamp          |
| **Status**       | Accepted · 2026-10-23 · decided by the owner                                                                                                                     |
| **Context**      | All subsystems.                                                                                                                                                  |
| **Rationale**    | Traceability: audit records and cases keep pointing at what they referred to.                                                                                    |
| **Consequences** | • The application's database role has no `DELETE` on these tables.<br>• Erasure requests under privacy law conflict with this; see `../production-readiness.md`. |

---

### CM-8. One email normalization

|                  |                                                                                                                                                                                                                                                     |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | One function, `normalizeEmail`, produces both the stored and the looked-up form of every email address:<br>• Trim surrounding whitespace<br>• Unicode NFC normalization<br>• Lowercase<br>• ASCII (punycode) domain<br>• No provider-specific rules |
| **Status**       | Superseded by CM-10 · 2026-10-23 · decided by the owner |
| **Context**      | Customer and employee emails.                                                                                                                                                                                                                       |
| **Rationale**    | • Lookups and uniqueness agree by construction.<br>• No near-duplicate identities.                                                                                                                                                                  |
| **Consequences** | The address as entered is kept for display.                                                                                                                                                                                                         |
| **Alternatives** | Provider-specific equivalences (dots, `+tags`): they can merge different people.                                                                                                                                                                    |

---

### CM-9. Authorization freshness by sensitivity

|                  |                                                                                                                                                                                                                                                                         |
| :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision**     | How fresh the principal's role must be depends on the decision:<br>• Reads: the role recorded from the session token at connection time<br>• State changes: the current role and status, re-read from the database<br>• A WebSocket connection never outlives its token |
| **Status** | Superseded by CM-16 · 2026-10-23 · decided by the owner |
| **Context**      | The CSR's chat connection and every decision made through it.                                                                                                                                                                                                           |
| **Rationale**    | • Performance for frequent, low-risk reads.<br>• Security for rare, sensitive changes: a demoted or disabled employee can never apply a change.                                                                                                                         |
| **Consequences** | • Role changes reach reads at the next token renewal.<br>• The UI renews the session over HTTP and reconnects.                                                                                                                                                          |
| **Related**      | [CM-3](#cm-3-application-sign-in-with-a-stateless-session-token)                                                                                                                                                                                                                                                                    |
| **Alternatives** | • Always read from the database: fresh, one round trip per decision.<br>• Always trust the token: stale for changes.                                                                                                                                                    |

---

### CM-10. Store only the normalized email

|  |  |
| :--- | :--- |
| **Decision** | Every email address is stored once, in normalized form, by one function, `normalizeEmail`:<br>• Trim surrounding whitespace<br>• Unicode NFC normalization<br>• Lowercase<br>• ASCII (punycode) domain<br>• No provider-specific rules |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Customer and employee emails. Supersedes CM-8, which also kept the address as entered. |
| **Rationale** | • Lookups and uniqueness agree by construction.<br>• Simplicity: the address as entered added no real value; an ASCII domain converts back to Unicode exactly for display. |
| **Consequences** | Sending to the exact address entered (case in the local part) is not possible; listed in `production-readiness.md`. |
| **Related** | [CM-8](#cm-8-one-email-normalization) |
| **Alternatives** | • Keep the address as entered for display (CM-8): a second column for cosmetic value.<br>• Provider-specific equivalences (dots, `+tags`): they can merge different people. |

---

### CM-11. Status for lifecycles, timestamps for facts

|  |  |
| :--- | :--- |
| **Decision** | One mechanism per kind of record:<br>• Things with a lifecycle, which move between states and can come back, have a **status** (`customer_status`, `account_status`, `identity_status`)<br>• Facts in time, which start, may end, and never reopen, have **start and end timestamps**, with `ended_by` and `end_reason`; active means not ended and not expired<br>• Coming back is a new fact: a new row |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | All subsystems. Holds, memberships, credentials, and assignments are facts in time. |
| **Rationale** | • Consistency: one way to cut something off per kind of record.<br>• Traceability: facts keep their history; no status and timestamp can disagree. |
| **Consequences** | Organization membership has no status (CI-2, amended). |
| **Related** | • [CM-7](#cm-7-never-delete-identities-or-history)<br>• [CI-2](customer-identity.md#ci-2-one-identity-per-person-membership-is-a-relationship) |
| **Alternatives** | Status and end timestamp together: two records of one fact. |

---

### CM-12. Kebab-case keys for reference data

|  |  |
| :--- | :--- |
| **Decision** | Readable keys of reference data are lowercase kebab-case:<br>• `business`, `owner`, `customer-support`, `support-case-handling`, `api-access`<br>• display names live in each table's `name` column<br>• enumeration values of `CHECK` columns stay PascalCase (`Active`, `Suspended`) |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Keys of plans, features, roles, departments, job functions, resource types, and operations. |
| **Rationale** | • Keys appear inside other identifiers (`feature.api-access.create-token`), where kebab-case reads well.<br>• One format, no guessing. |
| **Alternatives** | PascalCase keys: unreadable inside dotted permission keys. |

---

### CM-13. The database enforces structure; code enforces rules

|  |  |
| :--- | :--- |
| **Decision** | Each kind of rule has one enforcer:<br>• **Database:** structure: existence, uniqueness, and a column's type when it is a fixed fact about the column (an assignee is always an internal account)<br>• **Code:** rules: who may do what, state transitions, eligibility, conditions<br>• Every `*_by` column references the generic `account`; who may be the actor is decided by Access and Policy before the write<br>• Code that relies on a database guarantee says so, in a comment and in its contract, naming the constraint |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Every subsystem. Some rules could be written as constraints or as code. |
| **Rationale** | • Structure holds for every writer: seeds, scripts, bugs, future services.<br>• Rules change with the business; code is where they are expressive, tested, and changed safely.<br>• Stated once: an authorization rule is not repeated as a constraint. |
| **Consequences** | • Contracts name database guarantees (`@relies-on db: <constraint>`), so a reader knows the code does not check it itself.<br>• Removing a constraint means reviewing the code that relies on it. |
| **Examples** | • Database: `case_assignment.assignee_account_id` references `internal_account`; one active assignment per case (partial unique index).<br>• Code: only an employee holding `approval.decide` may set `decided_by`. |
| **Related** | • [CM-1](#cm-1-hexagonal-and-clean-architecture)<br>• [AC-1](access.md#ac-1-rbac-grants-policies-constrain) |
| **Alternatives** | • Everything in the database: rules become migrations, and authorization is written twice.<br>• Everything in code: integrity depends on every writer going through the code. |

---

### CM-14. UUIDv7 ids, stored natively, shown with a prefix

|  |  |
| :--- | :--- |
| **Decision** | Identifiers of entities with a lifecycle:<br>• generated in the application, through an `IdGenerator` port, as UUIDv7<br>• stored as PostgreSQL's native `uuid` (16 bytes)<br>• shown externally (API, chat, logs) as a kind prefix plus base64url: `aud_AZK6v3Wr7kq9Yg3hTs1wXQ`<br>• nothing relies on id order |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Every table. Reference data keeps readable kebab-case keys (CM-12). |
| **Rationale** | • Index locality: time-ordered ids insert at the end of indexes.<br>• Size: 16 bytes stored, 22 characters shown.<br>• The prefix keeps the kind visible where ids travel. |
| **Consequences** | • Ordering comes from timestamps, or `sequence_number` for the audit chain.<br>• An id reveals its creation time to the millisecond; ids are not secrets, every access is authorized. |
| **Alternatives** | • UUIDv4: no index locality.<br>• Text ids with prefixes in the database: larger, slower.<br>• Hex encoding: longer; base64url does not preserve order either, and order is not relied on. |
| **Amendments** | 2026-10-24 — the same rule covers hashes: stored as bytes, shown as unpadded base64url (a SHA-256 is 43 characters).<br>2026-10-25 — the prefix register lives in `data-model/README.md`. |

---

### CM-15. Foreign keys point down the layer order

|  |  |
| :--- | :--- |
| **Decision** | Subsystems form a layer order, and database foreign keys only point downward:<br>• customer identity, internal identity → account → access, product → entitlement → policy → authorization → support<br>• attribution is a sink: everyone writes to it; it depends on no one's tables<br>• a column that must point upward is a soft reference (no foreign key)<br>• no exceptions |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Every subsystem's tables and migrations. |
| **Rationale** | • Each subsystem's schema, migrations, and tests stand on what is below it.<br>• No cycles between subsystems.<br>• Audit records outlive and may outrank what they reference; a fail-closed audit is never blocked by another subsystem's table. |
| **Consequences** | • `audit_chain_record.case_id`, `change_request_id`, `policy_set_version` are soft references.<br>• Support records the grant a change created (`change_request.created_grant_id`); the grant does not reference Support.<br>• `organization_membership.ended_by` is dropped: the audit records who ended a membership.<br>• Soft references are safe because ids are immutable and never deleted (CM-7). |
| **Related** | • [CM-13](#cm-13-the-database-enforces-structure-code-enforces-rules)<br>• [CM-7](#cm-7-never-delete-identities-or-history) |
| **Alternatives** | • Foreign keys wherever possible: cycles between subsystems.<br>• An exception for `*_by` in identity tables: a cycle with Account. |
| **Amendments** | 2026-10-25 — attribution's references to `account` are soft too: attribution depends on no table. The order, bottom to top: customer identity, internal identity → account → product → access → entitlement → policy → authorization → support. `*_by` columns below Account are soft (CM-13 qualifier). |

---

### CM-16. The session token carries identity only

|  |  |
| :--- | :--- |
| **Decision** | The session token says who, never what they may do:<br>• claims: `sub` (the account), `sid` (the session, kept across renewals), `auth_time`, `iat`, `exp`, `jti`<br>• every decision loads the principal fresh: roles, assignments, holds, identity status<br>• `POST /api/session/renew` re-issues the token past half its lifetime, with the same `sid` and `auth_time`, never beyond 8 hours<br>• the server closes a WebSocket when its token expires; the UI renews over HTTP and reconnects |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Supersedes CM-9. Every decision already reads the database to write its audit record (AT-3), so token-carried roles saved nothing. |
| **Rationale** | • Security: a demotion, suspension, or hold takes effect on the next decision.<br>• `sid` groups a session's audit records across renewals; `jti` stays unique per token (RFC 7519). |
| **Consequences** | It remains a bearer token; binding it to the client (DPoP, mTLS) is listed in `production-readiness.md`. |
| **Related** | • [CM-3](#cm-3-application-sign-in-with-a-stateless-session-token)<br>• [CM-9](#cm-9-authorization-freshness-by-sensitivity)<br>• [AN-5](account.md#an-5-a-session-acts-as-one-declared-account) |
| **Alternatives** | Roles in the token, re-derived at renewal (CM-9): stale for up to half a lifetime, with no gain. |
| **Amendments** | 2026-10-25 — the claims also include `iss` and `aud`; renewal loads the principal and refuses an inactive identity or a suspended account. |

---

### CM-17. Authorization and attribution are reached through shared ports

|  |  |
| :--- | :--- |
| **Decision** | Cross-cutting services are ports, wired at bootstrap:<br>• `AuthorizationDecider` and `AuditRecorder` in shared `port/`, so a lower subsystem's use case can ask for a decision and record an audit without depending on higher subsystems<br>• a cascade lives in the highest subsystem it touches, or in the application (for example, ending a membership: Access and Account)<br>• sign-in lives in Account (it binds a session to an account)<br>• Account owns the `version` bump, called inside the unit of work by every write that affects an account |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Lower-layer use cases (grant expiry, holds, membership end, sign-in) needed higher subsystems, creating code cycles. |
| **Related** | • [CM-15](#cm-15-foreign-keys-point-down-the-layer-order)<br>• [AU-5](authorization.md#au-5-the-pdp-and-pip-live-in-authorization-peps-are-use-cases) |

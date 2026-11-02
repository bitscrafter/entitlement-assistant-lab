# Attribution — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | Who did what, to what, why it was allowed or refused, and the means to prove it later. |
| **References** | • Model: [`../data-model/attribution.md`](../data-model/attribution.md)<br>• Diagram: [`../diagrams/attribution.svg`](../diagrams/attribution.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [AT-1](#at-1-audit-records-traces-and-logs-are-distinct) | Audit records, traces, and logs are distinct |
| [AT-2](#at-2-one-actor-plus-participants) | One actor, plus participants |
| [AT-3](#at-3-every-decision-and-change-is-audited-or-it-does-not-happen) | Every decision and change is audited, or it does not happen |
| [AT-4](#at-4-a-keyed-hash-chain-makes-alteration-detectable) | A keyed hash chain makes alteration detectable |
| [AT-5](#at-5-action-keys-outcomes-and-reasons) | Action keys, outcomes, and reasons |
| [AT-6](#at-6-trace-and-session-correlation) | Trace and session correlation |
| [AT-7](#at-7-no-personal-data-in-the-audit) | No personal data in the audit |

---


## Decisions

### AT-1. Audit records, traces, and logs are distinct

| | |
| :--- | :--- |
| **Decision** | Three mechanisms, each with its own store:<br>• audit records (evidence) in PostgreSQL<br>• traces and logs (diagnosis) in the platform's observability<br>• requests rejected before authentication go to security event logs<br>• all three carry the `trace_id` |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Logging, tracing, auditing, and non-repudiation. |
| **Rationale** | Evidence needs completeness and integrity; diagnostics need volume and speed. One store cannot serve both. |
| **Alternatives** | Everything in one log: sampled evidence, or unaffordable diagnostics. |
| **Amendments** | 2026-10-25 — wording: attribution and tamper evidence (non-repudiation needs signed checkpoints, AT-4). |

---

### AT-2. One actor, plus participants

| | |
| :--- | :--- |
| **Decision** | Every audit record names:<br>• exactly one actor: the account that executed it<br>• at most one subject: the account acted on<br>• any number of participants, each with a role: `Contact`, `Requester`, `Approver` |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Several accounts take part in one action: a contact asks, an employee proposes, a supervisor approves, a system process applies. |
| **Rationale** | Non-repudiation (who did it) and traceability (who was involved), with participants shaped for many (CM-6). |
| **Examples** | An applied grant: actor `iac_sys_approval_process`; subject `acc_acme`; participants Contact `acc_jane`, Requester `iac_alex`, Approver `iac_sam`. |
| **Related** | [SU-8](support.md#su-8-a-customer-requested-change-needs-two-permissions) |
| **Alternatives** | One column per role: mostly empty, and a schema change per new role. |
| **Amendments** | 2026-10-25 — a `Contact` participant may be the subject itself (a person asking about their own account).<br>2026-10-25 — wording: who did it and who was involved; tamper evidence, not non-repudiation (AT-4). |

---

### AT-3. Every decision and change is audited, or it does not happen

| | |
| :--- | :--- |
| **Decision** | Audited: every authorization decision (reads and denials included), every state change, every authentication event, every system action:<br>• the record commits in the same transaction as the action (unit of work)<br>• if the record cannot be written, the action fails, reads included |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | Fail closed: nothing happens unaudited. Who looked at a customer's data is an audit question. |
| **Consequences** | Direct database access bypasses the application and needs database-level auditing (production). |
| **Related** | [CM-5](common.md#cm-5-the-llm-proposes-the-policy-engine-decides) |
| **Amendments** | 2026-10-25 — canonical records: one record per decision (the `account.read` gate is a finding of the action's decision, not its own record), plus one `Succeeded` or `Failed` record per execution.<br>2026-11-02 — two decisions are not recorded: the decision about the person an explanation evaluates (not that person's action; the employee's read is recorded, [explain-access D5](../features/explain-access/explain-access.verification-spec.md)), and an allowed listing of pending approvals (the panel lists every 30 seconds; each approval shown is decided again on `account.read`, and a refused listing is recorded; [grants-and-approvals discovery 35](../features/grants-and-approvals/workflow/discoveries.md)). |

---

### AT-4. A keyed hash chain makes alteration detectable

| | |
| :--- | :--- |
| **Decision** | Audit records form one chain:<br>• `sequence_number` from a single `audit_chain_head` row, locked at the last step of the transaction<br>• `record_hash` = HMAC-SHA-256 over the RFC 8785 canonical JSON of the whole record, including `previous_hash`, participants, and reasons<br>• the key is a Worker secret, named per record by `hash_key_id`<br>• append-only by database privileges |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | Non-repudiation: records must not be altered or denied afterwards. |
| **Rationale** | • Privileges prevent; the chain detects, by any means.<br>• A keyed hash cannot be recomputed without the key, unlike a plain hash.<br>• A locked row keeps the chain gapless; a sequence object would leave gaps on rollback. |
| **Consequences** | One global chain serializes audit writes; fine at one region. Asynchronous chaining, partitioned chains, audit checkpoints, and signatures are listed in `production-readiness.md`. |
| **Related** | [CM-13](common.md#cm-13-the-database-enforces-structure-code-enforces-rules) |
| **Alternatives** | • Plain SHA-256: anyone with write access can recompute the chain.<br>• Ed25519 per record: verifiable by anyone, but 10–100× slower; better on checkpoints.<br>• Optimistic locking on the head: concurrent writers retry whole transactions. |
| **Amendments** | 2026-10-25 — wording: the keyed chain gives tamper evidence (integrity), not non-repudiation, since the key holder could forge records; non-repudiation needs signed checkpoints (production). |

---

### AT-5. Action keys, outcomes, and reasons

| | |
| :--- | :--- |
| **Decision** | Each record classifies what happened with closed values:<br>• `action_key`: every permission key plus session events, in the `<resource>.<operation>` template<br>• `audit_outcome`: `Allow`, `Deny`, `RequiresApproval`, `Succeeded`, `Failed`<br>• `audit_reason` rows: codes namespaced `access.`, `entitlement.`, `policy.`, `account.`, `session.` |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | • One vocabulary for permissions and audit.<br>• Each reason says where it came from.<br>• A child table for reasons is standard SQL (portable) and consistent with participants. |
| **Alternatives** | A native array of reason codes: PostgreSQL-specific. |
| **Amendments** | 2026-10-24 — the outcome `RequiresApproval` becomes `Conditional`, with the obligations recorded in `detail` ([PO-3](policy.md#po-3-prerequisites-are-fulfilled-through-attributes)); `policy_set_version` references `policy_set`.<br>2026-10-25 — action keys also include lifecycle events that are not permissions (`case.close`, `case.set-subject`, `case.set-contact`, `case.authenticate-contact`, `change-request.confirm`, `change-request.cancel`, `approval.expire`), following the permission-key patterns of AC-3; the reason namespaces gain `support.`.<br>2026-10-25 — `case.reassign` joins the lifecycle events; `policy_set_version` is a soft reference (CM-15), not a foreign key. |

---

### AT-6. Trace and session correlation

| | |
| :--- | :--- |
| **Decision** | Every record carries two correlation ids:<br>• `trace_id`: one operation, from the W3C Trace Context `traceparent` header; each chat message starts a new trace<br>• `session_id`: the session token's `jti`, grouping a session's activity |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | From evidence to diagnostics in one step; "what did this session do?" in one query. |
| **Alternatives** | One trace per WebSocket connection: hours-long traces that explain nothing. |
| **Amendments** | 2026-10-25 — `session_id` is the token's `sid`, kept across renewals (CM-16), not its `jti`. |

---

### AT-7. No personal data in the audit

| | |
| :--- | :--- |
| **Decision** | The audit names accounts, never people:<br>• `detail` is typed per action key and never holds personal data<br>• a failed sign-in stores a keyed hash (HMAC) of the attempted identifier, never the value<br>• the conversation's text is not audited; tool calls are referenced by id |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Rationale** | • Privacy: the audit outlives conversations and is widely read.<br>• Typed identifiers sometimes contain passwords entered in the wrong field. |
| **Related** | [CM-10](common.md#cm-10-store-only-the-normalized-email) |

# Attribution — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | Who did what, to what, and why it was allowed or refused, recorded so that any later alteration is detectable. Attribution keeps the audit records; traces and logs live in the platform's observability. |
| **Status** | Ruled by the owner (2026-10-24; canonical records and soft account references 2026-10-25) |
| **References** | • Diagram: [`../diagrams/attribution.er.puml`](../diagrams/attribution.er.puml) (rendered: [`../diagrams/attribution.svg`](../diagrams/attribution.svg))<br>• Decisions: [`../adr/attribution.md`](../adr/attribution.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Three mechanisms](#1-three-mechanisms)
2. [Concepts](#2-concepts)
3. [Entities](#3-entities)
4. [What is audited](#4-what-is-audited)
   - [Reason-code register](#4a-reason-code-register)
5. [Writing a record](#5-writing-a-record)
6. [Tamper evidence](#6-tamper-evidence)
7. [Correlation](#7-correlation)
8. [Invariants](#8-invariants)
9. [Not addressed](#9-not-addressed)

---

## 1. Three mechanisms

| | Audit records | Traces | Logs (including security event logs) |
| --- | --- | --- | --- |
| Purpose | Evidence: who did what, and why it was allowed | Following one operation across components | Operational diagnosis; attack analysis |
| Completeness | Every audited event, never sampled | May be sampled | May be sampled |
| Retention | Long, governed | Short | Short |
| Personal data | Account ids only | Ids only | None; identifiers as keyed hashes |
| Lives in | PostgreSQL (this subsystem) | Platform observability | Platform observability |

All three carry the `trace_id`.

## 2. Concepts

| Term | Meaning |
| --- | --- |
| **Audit record** | The immutable record of one audited event; a row of `audit_chain_record`. |
| **Actor** | The account that executed the action. Exactly one per record, empty only for a failed sign-in. |
| **Subject** | The account acted on (the account context), if any. |
| **Participant** | Anyone else involved, with a **participant role**: `Contact` (the customer who asked), `Requester` (the employee who proposed a change), `Approver` (the employee who decided an approval). |
| **Action key** | What was attempted: every permission key, plus events that are not permissions: session events (`session.sign-in`, `session.renew`, `session.sign-out`, `session.switch-account`) and lifecycle events (`case.close`, `case.set-subject`, `case.set-contact`, `case.authenticate-contact`, `case.reassign`, `change-request.confirm`, `change-request.cancel`, `approval.expire`). Same patterns as permission keys (AC-3). |
| **Audit outcome** | `Allow`, `Deny`, `Conditional` (decisions; prerequisites in `detail`); `Succeeded`, `Failed` (executions). |
| **Reason code** | Why the outcome, namespaced by source: `access.`, `entitlement.`, `policy.`, `account.`, `session.`, `support.`. The register is §4a. |
| **Audit chain** | The records linked in sequence by keyed hashes, so that any alteration is detectable (tamper evidence). Non-repudiation would need signed checkpoints (production). |
| **Audit checkpoint** | A statement that record *N* had hash *H* at time *T*, kept where the database's writers cannot change it (production). |

## 3. Entities

| Entity | Key rules |
| --- | --- |
| `audit_chain_record` | Every reference is soft, with no foreign key: `actor_account_id`, `subject_account_id`, `case_id`, `change_request_id`, `policy_set_version` (CM-15). Attribution is a sink and depends on no other subsystem's tables; accounts are never deleted, so the references stay resolvable. Append-only: the application's database role has `INSERT` and `SELECT` only. `sequence_number` is unique and strictly increasing. `actor_account_id` may be empty only when `action_key = 'session.sign-in'` and `audit_outcome = 'Failed'` (check constraint). `detail` is typed per action key and never holds personal data. |
| `audit_participant` | Primary key `(audit_chain_record_id, participant_role, account_id)`; `account_id` is a soft reference. Never the actor; a `Contact` may be the subject itself (a person asking about their own account). |
| `audit_reason` | Primary key `(audit_chain_record_id, reason_code)`. Each code is one of the namespaces `access.`, `entitlement.`, `policy.`, `account.`, `session.`, `support.` followed by a kebab-case name (check constraint with a regular expression). |
| `audit_chain_head` | Exactly one row: the last sequence number and the last record hash. |

**A sample of `detail`:**

```json
{ "action_key": "change-request.apply", "detail": { "change_kind": "ChangePlan", "from_plan_key": "free", "to_plan_key": "pro" } }
{ "action_key": "account.read", "detail": { "tool": "explain_access", "tool_call_id": "call_8fK2", "feature_key": "sso", "operation": "configure" } }
{ "action_key": "session.sign-in", "audit_outcome": "Failed", "detail": { "attempted_identifier_hmac": "u0Yq3J9xw2Rk1A8sT-pZ4g", "failure": "InvalidCredentials" } }
```

## 4. What is audited

| Audited | Not audited (and where it is visible instead) |
| --- | --- |
| Every authorization decision, reads and denials included: **one record per decision** (the `account.read` gate is a finding within it, AT-3) | The conversation's text and the LLM's prompts (agent storage) |
| Every execution of a state change: **one record per execution**, after its decision's record | Requests rejected before authentication (security event logs) |
| Every authentication event: sign-in (success and failure), renewal that re-issues or is refused, sign-out, account switch; a renewal before half-life changes nothing and is not recorded | Reads of the product catalog (no customer data) |
| Every system action: grant expiry, approval timeout | Static files, health checks (logs) |
| | Direct database access by operators (a gap: database-level auditing, production) |

**The chain of an approved grant:**

| Record | Actor | Action key | Outcome | Participants |
| --- | --- | --- | --- | --- |
| 1 | `iac_alex` | `grant.create` | `Conditional` | Contact `acc_jane` |
| 2 | `iac_sam` | `approval.decide` | `Allow` | Requester `iac_alex` |
| 3 | `iac_sys_approval_process` | `change-request.apply` | `Allow` | Contact `acc_jane`, Requester `iac_alex`, Approver `iac_sam` |
| 4 | `iac_sys_approval_process` | `change-request.apply` | `Succeeded` | Contact `acc_jane`, Requester `iac_alex`, Approver `iac_sam` |

All four have subject `acc_acme`, the same `case_id` and `change_request_id`. Record 1 is the confirmation's
decision (Alex confirmed); record 3 is SU-15's re-run of that decision; record 4 is the execution.

## 4a. Reason-code register

| Code | Source | Meaning |
| --- | --- | --- |
| `account.operational-suspension` | Account | an employee suspended the account |
| `account.customer-removed` | Account | the customer was removed |
| `account.no-active-membership` | Account | an `OrganizationMember` account's individual has no active membership |
| `account.internal-identity-inactive` | Account | the internal identity is suspended or terminated |
| `access.permission-not-held` | Access | no role or assignment grants the permission |
| `access.contact-permission-not-held` | Access | the contact holds no customer permission for this change |
| `entitlement.no-subscription` | Entitlement | no subscription in force |
| `entitlement.subscription-canceled` | Entitlement | the last subscription was canceled |
| `entitlement.no-covering-term` | Entitlement | no subscription term covers the instant |
| `entitlement.feature-not-included` | Entitlement | neither plan, add-ons, nor grants include the feature |
| `entitlement.grant-adds-nothing` | Entitlement | a grant for something the account already has |
| `policy.<policy_key>` | Policy | an unmet policy |
| `session.invalid-credentials` | Session | sign-in failed |
| `session.absolute-lifetime-reached` | Session | renewal refused after 8 hours |
| `session.principal-inactive` | Session | renewal refused: the identity is no longer active or the account is suspended |
| `entitlement.plan-unchanged` | Entitlement | the target plan is the current plan |
| `support.stale-change-request` | Support | the subject account or its entitlements changed after the request was prepared |
| `support.not-case-assignee` | Support | the actor is not the case's current assignee (SU-14) |
| `support.no-matching-account` | Support | an account lookup matched no account |
| `support.case-closed` | Support | the case is closed |
| `support.contact-authentication-failed` | Support | the contact did not pass authentication |
| `support.approval-denied` | Support | an approver denied the change |
| `support.approval-expired` | Support | the approval was not decided in time |

Facts accompany each code (whose account, the hold, the last term's source).

## 5. Writing a record

Inside the audited action's own transaction (a unit of work), as its last step:

1. Lock `audit_chain_head` (`SELECT … FOR UPDATE`); concurrent writers wait here.
2. `sequence_number` = last + 1; `previous_hash` = last hash.
3. Compute `record_hash`; insert the record, its participants, and its reasons.
4. Update the head; commit with the action.

The head lock is held only for the last statements of the transaction, never across a round trip to the
language model or the browser; production-readiness covers the throughput limit it implies.

If the record cannot be written, the action fails: nothing happens unaudited (fail closed), reads included.

## 6. Tamper evidence

- **`previous_hash`** is the `record_hash` of record `sequence_number − 1` (32 zero bytes for the first).
- **`record_hash`** is HMAC-SHA-256, with the key named by `hash_key_id`, over the RFC 8785 canonical JSON
  of the whole record, including `previous_hash`, its participants (sorted by role, then account), and its
  reasons (sorted). Timestamps are RFC 3339 UTC with microseconds.
- **The key** is a Worker secret, never in the database or the repository. `hash_key_id` lets keys rotate
  while older records stay verifiable.
- **Verification** walks the records in `sequence_number` order, recomputes each hash, and checks each
  `previous_hash`. The first mismatch locates the alteration.
- **Two layers:** database privileges prevent changes through the application; the keyed chain detects
  changes by any means, and cannot be recomputed without the key.
- **One global chain.** Sessions and requests are filters (`session_id`, `trace_id`), not chains.

## 7. Correlation

| Column | Groups | Source |
| --- | --- | --- |
| `trace_id` | One operation: a request and everything it triggers. Each chat message starts a new trace. | W3C Trace Context `traceparent` header, created at the edge when absent |
| `session_id` | Every operation of one sign-in session, across renewals | The session token's `sid` (CM-16) |

## 8. Invariants

| Invariant | Guard |
| --- | --- |
| Audit records are never updated or deleted. | database role privileges (CM-13) |
| The chain is gapless and unforked. | `audit_chain_head` row lock; unique `sequence_number`; verification test |
| Every audited action commits with its record, or not at all. | unit of work; verification test |
| Only a failed sign-in lacks an actor. | check constraint |
| Reason codes belong to a known namespace. | check constraint |
| No personal data in `detail`; failed sign-in identifiers as keyed hashes. | typed `detail` per action key; review |

## 9. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): audit checkpoints, signatures
(Ed25519) on checkpoints, keys in a hardware security module, asynchronous chaining, partitioned chains
with a Merkle tree, retention and legal holds, security event management, alerting, and database-level
auditing of direct access.

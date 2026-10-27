# Support — Data Model

|  |  |
| :--- | :--- |
| **Purpose** | The CSR's work: cases, the changes requested in them, and the approvals some changes need. The conversation itself lives in each case agent's own storage; PostgreSQL holds what must be queried, enforced, and audited. |
| **Status** | Ruled by the owner (2026-10-23; lifecycle, authentication, approvals, assignee rule, and apply re-check 2026-10-25) |
| **References** | • Diagram: [`../diagrams/support.er.puml`](../diagrams/support.er.puml) (rendered: [`../diagrams/support.svg`](../diagrams/support.svg))<br>• Decisions: [`../adr/support.md`](../adr/support.md)<br>• Index: [`README.md`](README.md) |

## Contents

1. [Concepts](#1-concepts)
2. [Entities](#2-entities)
3. [The life of a case](#3-the-life-of-a-case)
4. [The life of a change request](#4-the-life-of-a-change-request)
5. [Change kinds and parameters](#5-change-kinds-and-parameters)
6. [The entitlement diff](#6-the-entitlement-diff)
7. [Approvals and deadlines](#7-approvals-and-deadlines)
8. [Invariants](#8-invariants)
9. [Interfaces with other subsystems](#9-interfaces-with-other-subsystems)
10. [Not addressed](#10-not-addressed)

---

## 1. Concepts

| Term | Meaning |
| --- | --- |
| **Case** | One customer matter handled by support. Opened, then closed with a reason and a summary. |
| **Subject account** | The customer account a case is about: the account context of every question in it. One per case, set once. |
| **Contact** | The person who reached support: always an individual's customer account. May be the subject itself. |
| **Contact authentication** | The CSR checks the contact against something already registered, and records its **kind** (the factor category: `Knowledge`, something the person knows; `Possession`, something they have) and **method** (`SecurityQuestion`, `AccountDetails`, `SupportPasscode`: Knowledge; `OneTimeCode`: Possession). Support never asks for a password. Valid for 30 minutes. Not identity proofing. |
| **Case assignment** | Which internal account owns the case during a span. Reassignment ends one assignment and starts another. |
| **Change request** | A change to the subject account's state, prepared in a case (the CSR asks, the assistant calls a tool that stores it): confirmed by the CSR, possibly conditional on an approval, then applied. Reads are not change requests; they are audit records. |
| **Change approval** | The decision a change request needs when a policy's outcome is `Conditional` with an `Approval` prerequisite. |
| **Entitlement diff** | What the subject account could use before and after the change, as an RFC 6902 JSON Patch. |
| **Case summary** | The gist of the case, written by the assistant at closing and reviewed by the CSR. |

Subjects and contacts are customer accounts; assignees, requesters, and deciders are internal accounts
([`account.md`](account.md)). Every `*_by` column references `account` (CM-13).

## 2. Entities

| Entity | Key rules |
| --- | --- |
| `support_case` | Id prefix `cse_`. `subject_account_id` references a customer account; `contact_account_id` an individual's customer account. Contact authentication: `contact_authenticated_at`, `contact_authentication_kind` (`Knowledge`, `Possession`), `contact_authentication_method` (`SecurityQuestion`, `AccountDetails`, `SupportPasscode`, `OneTimeCode`), `contact_authenticated_by` (the CSR); failed attempts are audit records (`support.contact-authentication-failed`). Changing the contact clears all four: an authentication belongs to one contact. A fact in time: closing sets `closed_at`, `closed_by`, `close_reason` (`Resolved`, `Abandoned`). Reopening means a new case. |
| `case_assignment` | Id prefix `asg_`. Fact in time (CM-11). `assigned_by`: the CSR opening the case, or a supervisor reassigning; `ended_by`: the reassigner, or whoever closed the case. Exactly one current assignment per open case (partial unique index over rows not ended). `end_reason`: `Reassigned`, `CaseClosed`. The current assignee is the only internal account that acts in the case (SU-14). |
| `change_request` | Its id is the idempotency key for applying it. `(case_id, subject_account_id)` references the case, so a change targets the case's subject and cannot exist before the case has one. `contact_account_id` freezes the authenticated contact who asked (empty when the CSR initiated it). `confirmed_by` records who confirmed. `created_grant_id` records the grant the change created (CM-15). Never edited: a different change is a new request. |
| `change_approval` | Its own id; constrained to one per change request (CM-6). Its id is also the id of the approval's process instance, started after commit through an outbox row (SU-6). `approval_status`: `Pending`, `Approved`, `Denied`, `Expired`, `Canceled`. `decided_by`: the supervisor who decided; empty while `Pending`, `Expired`, or `Canceled`. `decision_reason` required when `Denied`; `Other` requires `decision_comment`. |

## 3. The life of a case

Each step is a use case with its own action key, audited (SU-9). Every step except `case.open` and `case.reassign` requires the actor to be the case's current assignee (`actor_is_assignee`, SU-14); otherwise `support.not-case-assignee`. On a closed case every step is refused (`support.case-closed`).

| Step | Action key | Rule |
| --- | --- | --- |
| Open | `case.open` | assigned to the opener's internal account |
| Set the subject | `case.set-subject` | the decision includes `account.read` on the account (AU-4); confirmed by the CSR in the UI, never chosen silently by the LLM; set once |
| Set the contact | `case.set-contact` | an individual's customer account; clears any contact authentication |
| Authenticate the contact | `case.authenticate-contact` | records the kind and the CSR; required before a contact can ask for changes (`policy.contact-is-authenticated`) |
| Reassign | `case.reassign` | permission `case.reassign` (supervisor role); ends the current assignment, starts a new one |
| Close | `case.close` | in one transaction: cancels change requests awaiting confirmation, cancels `Pending` approvals and their changes, writes outbox rows that terminate their process instances; the assistant drafts the case summary |

## 4. The life of a change request

```text
CSR asks ──▶ AwaitingConfirmation (parameters, subject_account_version, entitlement_diff stored)
               ├─ CSR cancels, or the case closes ──────────────────────▶ Canceled
               ├─ the subject account changed (stale) ─────────────────▶ Canceled · support.stale-change-request
               └─ CSR confirms ─┬─ decision Deny ────────────────────────▶ Refused
                                ├─ decision Allow ───────────────────────▶ Applied
                                └─ decision Conditional (Approval) ─▶ AwaitingApproval + change_approval (Pending)
                                        ├─ approved, re-checks hold (SU-15) ─▶ Applied
                                        ├─ approved, re-run decision denies ─▶ Refused
                                        ├─ approved, account or diff changed ▶ Canceled · support.stale-change-request
                                        ├─ denied ───────────────────────────▶ Refused
                                        ├─ not decided in time ──────────────▶ Expired
                                        └─ the case closes ──────────────────▶ Canceled
```

**Preparing** stores the parameters, the subject's current `account.version` as
`subject_account_version`, and the diff. A target plan equal to the current plan is refused at preparation
(`entitlement.plan-unchanged`). Change tools act on the case's subject only (SU-9).

**Confirming** is a client action the LLM cannot trigger (an endpoint or a typed frame), and the
confirmation card renders the stored diff, never model text (SU-9). The confirmer is recorded in
`confirmed_by`. Confirming runs in one transaction:

1. The subject account's version still equals `subject_account_version`; otherwise the request is
   `Canceled` with `support.stale-change-request`.
2. The diff's `test` operations hold against the current effective entitlements.
3. The decision chain runs with the principal loaded fresh (CM-16).
4. On `Allow`: the change is applied and the version advanced in one statement
   (`UPDATE account SET version = version + 1 WHERE account_id = $1 AND version = $2`; no row updated
   means stale), statuses are set, and the audit records are written, all or nothing.
5. On `Conditional`: the request becomes `AwaitingApproval`, a `Pending` approval and an outbox row are
   written; the version does not move, because nothing has changed yet.

A refused confirmation rolls back; its audit record is then written in its own transaction (SU-13).

**Applying an approved change** (SU-15) re-runs the confirmer's decision with their current state and
`approval_granted`, checks that `sys_approval_process` holds `change-request.apply` and is not suspended,
checks that the subject's version still equals `subject_account_version`, and re-checks the stored diff's
`test` operations. A denying decision ends the change `Refused`; a changed account or diff ends it
`Canceled` (`support.stale-change-request`); the case is notified either way. What is applied is exactly
what the confirmer saw and the approver approved, or nothing.

`requested_by` proposed the change; `confirmed_by` confirmed it; `applied_by` executed it (the CSR for a
direct `Allow`, recorded under the governing permission; `sys_approval_process` after an approval).

## 5. Change kinds and parameters

Each kind maps to exactly one employee permission and, when a contact asks, one customer permission (SU-8).

| `change_kind` | Employee permission | Contact permission | Parameters |
| --- | --- | --- | --- |
| `ChangePlan` | `subscription.change-plan` | `subscription.request-plan-change` | `target_plan_key` (never the current plan). An upgrade to a `Paid` target adds coverage: `source` (`Trial`, `Courtesy`) and `duration_days`, within the policy limits. A downgrade to a `Free` plan starts a `FreePlan` term. A `Paid` target without coverage is refused when no current term covers it. |
| `CancelSubscription` | `subscription.cancel` | `subscription.request-cancellation` | none; needs an authenticated contact or an approval (`cancel-needs-contact-or-approval`) |
| `CreateGrant` | `grant.create` | `grant.request` | `feature_key`, `quota` (metered only, within the policy limit), `duration_days`, `reason` |
| `AddCourtesyTerm` | `subscription.add-courtesy-term` | — (the CSR's own initiative) | `duration_days`, `reason` |

## 6. The entitlement diff

An RFC 6902 JSON Patch over the subject account's effective-entitlements document (features keyed by
`feature_key`, each with its quota and sources). `test` operations record the values before the change;
`add`, `remove`, and `replace` record the change. The UI renders it as a diff ("seats: 3 → 25"). Because
`test` operations fail on a changed document, the patch is also a second staleness check.

```json
[
  { "op": "test",    "path": "/seats/quota",   "value": 3 },
  { "op": "replace", "path": "/seats/quota",   "value": 25 },
  { "op": "replace", "path": "/seats/sources", "value": ["plan:pro"] },
  { "op": "add",     "path": "/api-access",    "value": { "quota": null, "sources": ["plan:pro"] } }
]
```

## 7. Approvals and deadlines

| Concern | Rule |
| --- | --- |
| Where supervisors decide | `ListPendingApprovals` and `DecideApproval`: endpoints and a UI panel shown only to holders of `approval.decide`, not LLM tools (SU-12). The decider is neither the requester nor the confirmer (`policy.no-self-approval`). A denial records `support.approval-denied`. |
| Approval timeout (72 hours) | A timer in the approval's process instance waits for the decision or the deadline, without polling. On timeout (`approval.expire`, by `sys_approval_process`), the approval and the change become `Expired` in one transaction (`support.approval-expired`), and the case is notified. |
| Window state | A decision is accepted only while the approval is `Pending` and `expires_at` has not passed, checked in the deciding transaction (`UPDATE … WHERE approval_status = 'Pending' AND expires_at > now()`); a late timer finds nothing to expire, a late decision is refused. |
| Outbox | Starting or terminating a process instance is written as an outbox row in the same transaction as the state change; a relay delivers it after commit, idempotently by approval id. A crash never leaves a pending approval without a timer. |
| Grant expiry | A scheduled sweep records expired grants (EN-5); access already stops at evaluation. |

## 8. Invariants

| Invariant | Guard |
| --- | --- |
| The subject is a customer account; the contact an individual's customer account; assignees internal accounts. | foreign keys to `customer_account` (with `contact_customer_kind = 'Individual'`) and `internal_account` |
| A change targets its case's subject. | composite foreign key `(case_id, subject_account_id)` |
| A customer-requested change needs an authenticated contact holding the customer permission, and a CSR holding the employee permission. | decision chain (AU-1); `policy.contact-is-authenticated` |
| One current assignment per open case. | partial unique index |
| A change is applied at most once, exactly as shown. | change request id as idempotency key; version check, conditional version bump, and diff `test` operations in the applying transaction |
| Closing a case leaves nothing pending. | case-closing use case, one transaction |
| A decision after `expires_at`, or on a non-`Pending` approval, is refused. | conditional update in the deciding transaction |
| Only the current assignee acts in a case. | decision context `actor_is_assignee` (SU-14) |
| An approved change applies only as confirmed. | SU-15 re-checks in the applying transaction |

## 9. Interfaces with other subsystems

| Subsystem | Relationship |
| --- | --- |
| Account | Subject and contact are customer accounts; assignees and deciders internal accounts. `account.version` is the optimistic-concurrency token; Account owns the bump, Support calls it in the applying transaction. |
| Authorization | Every step asks the decision chain through the shared `AuthorizationDecider` port (CM-17); employee-initiated subject-touching steps include `account.read` in the decision (AU-4). |
| Entitlement | Applied changes create terms, add-ons, and grants; the diff is computed from effective entitlements. |
| Policy | `Deny` or `Conditional` findings for each change; contact authentication; separation of duties; coverage and quantity limits. |
| Attribution | Every decision and every execution writes an audit record through the shared `AuditRecorder` port (CM-17), referencing the case and change request. |

## 10. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md): queues and routing, service levels,
contact authentication methods, notifications beyond the application, conversation retention and export,
external ticketing systems, approval escalation.

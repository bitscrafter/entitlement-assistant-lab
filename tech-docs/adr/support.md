# Support — Architecture Decisions

|  |  |
| :--- | :--- |
| **Purpose** | Cases, the changes requested in them, and the approvals some changes need. |
| **References** | • Model: [`../data-model/support.md`](../data-model/support.md)<br>• Diagram: [`../diagrams/support.svg`](../diagrams/support.svg)<br>• Index and template: [`README.md`](README.md) |

---

## Contents

| Number | Name |
| :--- | :--- |
| [SU-1](#su-1-case-ownership-through-assignments) | Case ownership through assignments |
| [SU-2](#su-2-one-subject-account-per-case-and-a-separate-contact) | One subject account per case, and a separate contact |
| [SU-3](#su-3-change-requests-for-changes-only) | Change requests, for changes only |
| [SU-4](#su-4-confirming-applies-exactly-what-was-shown) | Confirming applies exactly what was shown |
| [SU-5](#su-5-every-change-request-ends-in-a-final-status) | Every change request ends in a final status |
| [SU-6](#su-6-approvals-in-their-own-table-with-a-durable-timer) | Approvals in their own table, with a durable timer |
| [SU-7](#su-7-the-conversation-stays-in-the-agent-the-summary-in-the-database) | The conversation stays in the agent; the summary in the database |
| [SU-8](#su-8-a-customer-requested-change-needs-two-permissions) | A customer-requested change needs two permissions |
| [SU-9](#su-9-case-lifecycle-steps-are-use-cases-confirmed-outside-the-llm) | Case lifecycle steps are use cases, confirmed outside the LLM |
| [SU-10](#su-10-contacts-are-authenticated) | Contacts are authenticated |
| [SU-11](#su-11-applying-an-approved-change-re-runs-the-decision) | Applying an approved change re-runs the decision |
| [SU-12](#su-12-supervisors-decide-approvals-outside-the-chat) | Supervisors decide approvals outside the chat |
| [SU-13](#su-13-stale-change-requests-are-canceled-refusals-are-audited-on-their-own) | Stale change requests are canceled; refusals are audited on their own |
| [SU-14](#su-14-case-actions-require-the-cases-assignee) | Case actions require the case's assignee |
| [SU-15](#su-15-applying-an-approved-change-re-runs-the-confirmers-decision-against-what-was-shown) | Applying an approved change re-runs the confirmer's decision against what was shown |

---


## Decisions

### SU-1. Case ownership through assignments

| | |
| :--- | :--- |
| **Decision** | A case is owned through `case_assignment`, a fact in time:<br>• the assignee is an internal account<br>• one current assignment per open case<br>• reassignment ends one assignment and starts another |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Cases may be reassigned; other kinds of internal accounts may own cases later. |
| **Rationale** | • History of who owned the case when.<br>• An internal account, not an employee, keeps ownership open to other identity kinds. |
| **Related** | [CM-11](common.md#cm-11-status-for-lifecycles-timestamps-for-facts) |
| **Alternatives** | An owner column on the case: no reassignment history. |

---

### SU-2. One subject account per case, and a separate contact

| | |
| :--- | :--- |
| **Decision** | A case is about one customer account, and records who reached support:<br>• `subject_account_id`: the account the case is about, set once<br>• `contact_account_id`: the person contacting support, an individual's account<br>• the contact's verification as columns on the case (designed, built with its scenario) |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | The subject is the account context of every question in the case. |
| **Rationale** | • Clear attribution: a case and its changes concern one account.<br>• Contact and subject apart enable "a contact may only request changes their role allows". |
| **Examples** | Jane contacts support about Acme: subject `acc_acme`, contact `acc_jane`. Jane contacts support about her own account: both `acc_jane`. |
| **Alternatives** | • Several accounts over time per case: more history, less clarity.<br>• A contact table: only useful with several contacts per case. |
| **Amendments** | 2026-10-24 — the term *caller* is renamed *contact*: channel-neutral (phone, chat, email, web form).<br>2026-10-25 — contact authentication replaces verification: `contact_authenticated_at`, `contact_authentication_kind`, `contact_authenticated_by` (SU-10).<br>2026-10-25 — once the subject is set, the read tools act only on it; only `findCustomerAccount` crosses accounts. |

---

### SU-3. Change requests, for changes only

| | |
| :--- | :--- |
| **Decision** | A change to the subject account is a `change_request`:<br>• reads are audit records, not requests<br>• a closed set of kinds, each requiring exactly one permission<br>• `parameters` as `jsonb`, validated strictly per kind<br>• never edited: a different change is a new request |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Changes have a lifecycle (confirm, approve, apply) that reads do not. |
| **Rationale** | • The name says it changes state (the common service-management term).<br>• One typed column fits a small, closed set of kinds. |
| **Examples** | `ChangePlan` with `target_plan_key: pro`; `CreateGrant` with `feature_key`, `duration_days`, `reason`. |
| **Alternatives** | • "Case request" or "proposal": do not say a change.<br>• A table per kind: more structure for a few fields. |

---

### SU-4. Confirming applies exactly what was shown

| | |
| :--- | :--- |
| **Decision** | A change request stores what the CSR saw, and confirming applies only that:<br>• `subject_account_version`: the subject account's version when proposed; a mismatch is stale<br>• `entitlement_diff`: an RFC 6902 JSON Patch whose `test` operations must still hold<br>• re-authorization with current role and status (CM-9)<br>• all in one transaction, keyed by the change request id |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Time passes between proposing and confirming; others may change the account. |
| **Rationale** | • Integrity: nothing different from what was displayed is ever applied.<br>• A standard diff format, with before-values and a built-in staleness check. |
| **Examples** | Alex proposes Free → Pro at version 7; Blair's grant makes it 8; Alex's confirmation is refused as stale and re-proposed. |
| **Related** | [CM-9](common.md#cm-9-authorization-freshness-by-sensitivity) |
| **Alternatives** | • A request version: the request never changes, the account does.<br>• A diff format of our own: no standard, no built-in check. |
| **Amendments** | 2026-10-25 — the principal is loaded fresh (CM-16); a `Conditional` confirmation locks and compares the version without advancing it; the version advances only at apply (SU-15). |

---

### SU-5. Every change request ends in a final status

| | |
| :--- | :--- |
| **Decision** | A change request ends in exactly one final status:<br>• `Applied`<br>• `Canceled`: withdrawn, or its case closed while awaiting confirmation<br>• `Refused`: denied by policy or by an approver<br>• `Expired`: its approval was not decided in time |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Rationale** | No change is left in limbo; closing a case leaves nothing pending. |
| **Amendments** | 2026-10-25 — `Refused` covers any denial by the decision chain or an approver; `Canceled` also covers stale requests (SU-13) and requests awaiting approval when the case closes (SU-12). |

---

### SU-6. Approvals in their own table, with a durable timer

| | |
| :--- | :--- |
| **Decision** | An approval is a `change_approval` row:<br>• at most one per change request for now (CM-6)<br>• `process_instance_id`: the long-running process that waits for the decision or the deadline<br>• `decision_reason` from a closed set, required when denied; an optional comment<br>• separation of duties is a policy |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Context** | Approvals are asynchronous: a supervisor may decide hours later, or never. |
| **Rationale** | • Shaped for multi-step approvals.<br>• A durable timer expires the approval without polling; decisions after the deadline are refused.<br>• Provider-neutral naming: the orchestrator sits behind a port. |
| **Consequences** | On timeout, the approval and the change become `Expired` in one transaction, and the case is notified. |
| **Related** | [CM-6](common.md#cm-6-shape-for-many-constrain-to-one) |
| **Alternatives** | • Approval columns on the change request: no room for multi-step approvals.<br>• A scheduled sweep for timeouts: the process is already waiting; a timer is exact. |
| **Amendments** | 2026-10-25 — the process instance id is the approval id; the instance is created after commit through an outbox, with a reconciliation sweep; instances re-read the database before acting. |

---

### SU-7. The conversation stays in the agent; the summary in the database

| | |
| :--- | :--- |
| **Decision** | Each store keeps what it is for:<br>• the conversation lives in the case agent's own storage<br>• `case_summary` on the case, written at closing and reviewed by the CSR<br>• change requests, approvals, and audit records carry every action |
| **Status** | Accepted · 2026-10-23 · decided by the owner |
| **Rationale** | The conversation is memory, not a system of record; the outcome stays on record without the transcript. |
| **Consequences** | Conversation retention and export are listed in `production-readiness.md`. |

---

### SU-8. A customer-requested change needs two permissions

|  |  |
| :--- | :--- |
| **Decision** | A change asked for by a contact is checked twice, and the contact is recorded on it:<br>• the contact may **ask**: their account holds the customer permission in the subject account (`subscription.request-plan-change`, `subscription.request-cancellation`, `grant.request`)<br>• the CSR may **perform**: their account holds the employee permission (`subscription.change-plan`, `subscription.cancel`, `grant.create`)<br>• `change_request.contact_account_id` freezes who asked; empty when the CSR acts on their own initiative |
| **Status** | Accepted · 2026-10-24 · decided by the owner |
| **Context** | The subject is changed, the contact asks, the CSR performs. |
| **Rationale** | • Authority: a contact cannot obtain through support what their own role does not allow.<br>• Attribution: the chain (subject, contact, requester, approver, executor) is recorded on the change itself. |
| **Examples** | Jane (Admin at Acme) asks for a grant: allowed if Admin holds `grant.request` and Alex holds `grant.create`. Carol (Viewer) asks: refused, whatever Alex holds. |
| **Related** | • [SU-2](#su-2-one-subject-account-per-case-and-a-separate-contact)<br>• [AC-4](access.md#ac-4-account-role-assignments-justified-by-a-relationship) |
| **Alternatives** | Checking only the CSR: any contact could obtain any change through support. |
| **Amendments** | 2026-10-24 — the term *caller* is renamed *contact*; the column is `contact_account_id`. |

---

### SU-9. Case lifecycle steps are use cases, confirmed outside the LLM

|  |  |
| :--- | :--- |
| **Decision** | Each step of a case is a use case with its own action key, audited:<br>• `case.open`, `case.close`, `case.set-subject` (passes the `account.read` gate, confirmed in the UI), `case.set-contact`, `case.authenticate-contact`<br>• `change-request.confirm`, `change-request.cancel`: client actions the LLM cannot trigger (an endpoint or a typed frame), rendering the stored diff, never model text<br>• a CSR's direct apply is recorded under the governing permission (`subscription.change-plan`, `Succeeded`) |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Lifecycle steps had no action key, so they could be neither authorized nor audited; an LLM-chosen subject could be steered by injected text. |
| **Related** | • [AT-5](attribution.md#at-5-action-keys-outcomes-and-reasons)<br>• [CM-5](common.md#cm-5-the-llm-proposes-the-policy-engine-decides) |
| **Amendments** | 2026-10-25 — `case.reassign` is a lifecycle action key (governed by the `case.reassign` permission); change requests are prepared, not proposed. |

---

### SU-10. Contacts are authenticated

|  |  |
| :--- | :--- |
| **Decision** | Before a contact can ask for changes, the CSR authenticates them against something already registered:<br>• `contact_authenticated_at`, `contact_authentication_kind` (`Knowledge`, `Possession`), `contact_authentication_method`, `contact_authenticated_by` on the case<br>• policy `contact-is-authenticated`, active from the grants-and-approvals feature<br>• a customer-requested change also needs the contact's customer permission (SU-8) |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | "Verification" usually means identity proofing at registration; checking a known person against registered factors is authentication (caller authentication in contact centers). |
| **Related** | [SU-8](#su-8-a-customer-requested-change-needs-two-permissions) |
| **Alternatives** | Deferring authentication to a stretch scenario: contacts merely identified could ask for changes. |
| **Amendments** | 2026-10-25 — changing the contact clears the authentication columns; authentication belongs to one contact.<br>2026-10-26 — kind and method (case-lifecycle D4): kinds are factor categories (`Knowledge`, `Possession`); methods `SecurityQuestion`, `AccountDetails`, `SupportPasscode` (Knowledge), `OneTimeCode` (Possession); a password is never a method. An authentication is valid for 30 minutes (D5). |

---

### SU-11. Applying an approved change re-runs the decision

|  |  |
| :--- | :--- |
| **Decision** | An approved change is applied only if, at that moment:<br>• the requester's original decision, re-run with their current state and `approval_granted`, allows it<br>• the executing system account holds `change-request.apply` and is not suspended<br>• the entitlement diff is recomputed against the current state<br>Otherwise the change becomes `Refused` with its reason codes, and the case is notified. |
| **Status** | Superseded by SU-15 · 2026-10-25 · decided by the owner |
| **Context** | Up to 72 hours pass between requesting and approving. |
| **Rationale** | Nothing applies on authority or conditions that no longer hold. |
| **Related** | • [PO-3](policy.md#po-3-prerequisites-are-fulfilled-through-attributes)<br>• [CM-16](common.md#cm-16-the-session-token-carries-identity-only) |

---

### SU-12. Supervisors decide approvals outside the chat

|  |  |
| :--- | :--- |
| **Decision** | Approvals have their own small surface:<br>• `ListPendingApprovals` and `DecideApproval`: endpoints and a UI panel, not LLM tools<br>• the decider holds `approval.decide`, and is never the requester (`policy.no-self-approval`)<br>• closing a case cancels its change requests awaiting confirmation or approval, and their process instances |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Related** | [SU-6](#su-6-approvals-in-their-own-table-with-a-durable-timer) |
| **Amendments** | 2026-10-25 — deciding requires `Pending` and the deadline not passed; applying locks the request and requires `Approved` and `AwaitingApproval`; closing a case cancels only `Pending` approvals and refuses while an apply runs. Listing approvals gates each one through `account.read` and is audited; `no-self-approval` excludes both requester and confirmer. |

---

### SU-13. Stale change requests are canceled; refusals are audited on their own

|  |  |
| :--- | :--- |
| **Decision** | When the subject account changed after a request was prepared:<br>• the request ends `Canceled`, reason `support.stale-change-request`, and the assistant prepares a fresh one<br>• a refused confirmation rolls back, and its audit record is then written in its own transaction |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | A refusal's audit record would otherwise roll back with the refused transaction. |
| **Related** | [AT-3](attribution.md#at-3-every-decision-and-change-is-audited-or-it-does-not-happen) |
| **Amendments** | 2026-10-25 — the second transaction writes the final status and the audit record together, only if the request is still `AwaitingConfirmation`. |

---

### SU-14. Case actions require the case's assignee

|  |  |
| :--- | :--- |
| **Decision** | Every case action (set subject or contact, authenticate the contact, prepare, confirm, cancel, close) requires the actor to be the case's current assignee:<br>• Support's PEP template supplies `context.actor_is_assignee`<br>• otherwise `Deny` with `support.not-case-assignee`<br>• lifecycle action keys are governed by permissions: `case.*` by `case.open` (and assignee); confirm and cancel by the change kind's employee permission; `case.reassign` by `case.reassign`; `approval.expire` by `change-request.apply` |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | The assignee was checked only when connecting; lifecycle keys had no governing permission and could never pass default deny. |
| **Related** | • [SU-9](#su-9-case-lifecycle-steps-are-use-cases-confirmed-outside-the-llm)<br>• [AU-3](authorization.md#au-3-default-deny-lives-in-the-access-step) |

---

### SU-15. Applying an approved change re-runs the confirmer's decision against what was shown

|  |  |
| :--- | :--- |
| **Decision** | An approved change is applied only if, at that moment:<br>• the **confirmer's** decision, re-run with their current state and `approval_granted`, allows it<br>• the executing system account holds `change-request.apply` and is not suspended<br>• the stored entitlement diff's `test` operations still hold (nothing different from what was shown is applied)<br>Otherwise the change ends `Refused` (decision) or `Canceled` (stale, `support.stale-change-request`), and the case is notified. The account version advances only when a change is applied. |
| **Status** | Accepted · 2026-10-25 · decided by the owner |
| **Context** | Supersedes SU-11, which re-ran the requester's decision and recomputed the diff, applying something no one had seen. |
| **Related** | • [SU-4](#su-4-confirming-applies-exactly-what-was-shown)<br>• [SU-11](#su-11-applying-an-approved-change-re-runs-the-decision) |
| **Alternatives** | Recomputing the diff at apply (SU-11): applies an unseen change. |

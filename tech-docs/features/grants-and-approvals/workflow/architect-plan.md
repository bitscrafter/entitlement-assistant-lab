# Grants and Approvals — Architect Plan

| | |
| :--- | :--- |
| **Purpose** | How grants-and-approvals is built: spikes, phases, ports, adapters, schema, and the scenarios each phase turns green. |
| **Status** | Approved by the owner (2026-10-27): Q1 B′ (an extension ends the grant and starts a linked one), Q2–Q4 as recommended, the transactional outbox, the terms of §9 |
| **Feature** | grants-and-approvals · S15a–S15b, S17a, S18a, S21a–S21c, S22a, S23a, S24a–S24e, S25a–S25b, S26a–S26b, S38a–S38b, S39a–S39c |
| **References** | • Spec: [`../grants-and-approvals.verification-spec.md`](../grants-and-approvals.verification-spec.md)<br>• Support: [`../../../adr/support.md`](../../../adr/support.md), [`../../../data-model/support.md`](../../../data-model/support.md)<br>• Entitlement: [`../../../data-model/entitlement.md`](../../../data-model/entitlement.md)<br>• API: [`../../../api/api.md`](../../../api/api.md) §6, §7, §9 |

## Contents

1. [Starting point](#1-starting-point)
2. [Spikes](#2-spikes)
3. [Phases](#3-phases)
4. [Building blocks and styles](#4-building-blocks-and-styles)
5. [Ports and adapters](#5-ports-and-adapters)
6. [Schema and seed](#6-schema-and-seed)
7. [Test approach](#7-test-approach)
8. [Deployment](#8-deployment)
9. [Proposed terms](#9-proposed-terms)
10. [Open questions](#10-open-questions)
11. [Self-review](#11-self-review)

## 1. Starting point

What exists: cases, their subject, contact, and authentication; the case action enforcement (locked case row,
combined decision, records); case events from audit records; the PDP pipeline with its five steps; effective
entitlements with grants as sources; the five policies this feature needs, already in the policy set; the grant
table (`entitlement_grant`) and the policy attribute schema (`duration_days`, `quota`, `has_contact`,
`contact_authenticated`, `requester_account_id`, `confirmer_account_id`, `approval_granted`).

What is missing:

- **Decisions with context.** `DecisionRequest` has no context and no contact; the contact access step is a
  placeholder (SU-8); the entitlement step does not judge changes (EN-4).
- **Change requests and approvals.** Their tables, use cases, endpoints, tools, and cards.
- **The durable process.** An approval Workflow, an outbox, a scheduled sweep.
- **Grant changes.** Creating, revoking, and extending grants; the entitlement diff; recording expiry.
- **The approvals panel** for supervisors.

## 2. Spikes

| # | Question | Pass | If it fails |
| --- | --- | --- | --- |
| K1 | Can a Cloudflare Workflow per approval, started by the Worker after commit, wait for **either** a decision event **or** a deadline, run in Wrangler's test harness, and be told the decision by the Worker? | in the harness: an instance started with a deadline a few seconds away expires; another receives a decision event and acts; both re-read the database before acting | a Durable Object per approval with an alarm at `expires_at` and an RPC for the decision: the same port, another adapter |
| K2 | Does a Cron trigger (`scheduled`) run in the harness, so the sweeps are tested through the Worker? | the harness triggers `scheduled` and the sweep runs | the sweeps are use cases tested directly; `scheduled` is a one-line adapter covered by the deploy's smoke test |

## 3. Phases

| Phase | Name | Work | Scenarios green |
| --- | --- | --- | --- |
| P1 | Schema, seed, harness, RED | Migrations (§6); Morgan in the seed; harness Givens (change requests, approvals, grants at given instants, a dropped Workflow start, the clock moved past a deadline); the verification tests (RED gate) | — |
| P2 | Decisions with context | `DecisionRequest` gains `context` and `contactAccountId`; the PIP computes `duration_days` as the days granted for the feature on the subject within the last 90 days, the request's included (D5); the contact access step (SU-8): the contact's customer permission in the subject; the entitlement step judges grant changes (EN-4: already included, quota on unmetered, no subscription); D17's disclosure for changes | S21c |
| P3 | Grants and the diff | Entitlement use cases: `CreateGrant`, `RevokeGrant`, `ExtendGrant`, `RecordGrantExpiries`; the entitlement diff (RFC 6902 over the effective-entitlements document) as a pure function with its `test` operations | S22a (use case) |
| P4 | Change requests | Support: `PrepareChangeRequest` (three kinds; preview decision; stored diff and version); `GetChangeRequest`; `ConfirmChangeRequest` (idempotent; version and diff checks; decision; apply, or approval with an outbox row; the contact's authentication recorded); `CancelChangeRequest`; closing a case cancels what is pending (D14); endpoints | S21a (http), S21b, S15a, S15b, S17a, S38a, S39a |
| P5 | Approvals and the process | `ListPendingApprovals`, `DecideApproval` (window check in the deciding transaction; denial reasons; `no-self-approval`); `ApplyApprovedChange` (SU-15, re-run as of confirmation, D8); `ExpireApproval`; the outbox relay and reconciliation; the `ApprovalProcess` port and its Workflow adapter (K1); the `scheduled` sweeps (K2) | S23a, S24a–S24e, S25a–S25b, S26a–S26b, S39b, S39c |
| P6 | Agent and case events | The three tools (strict arguments, on the subject only); the change request card from the tool result; case events for every change and approval outcome (D15); the instructions | S18a, S21a (agent), S38b |
| P7 | UI | The change request card with Confirm and Cancel, re-read after a click; the approvals panel (a page for holders of `approval.decide`: list, approve, deny with a reason) | — |
| P8 | Deploy | Neon migrations and seed (Morgan); `wrangler.jsonc`: the Workflow binding and class, the Cron trigger; deploy; smoke test by script and in the browser; a live check when Workers AI answers | — |

## 4. Building blocks and styles

| Block | Style |
| --- | --- |
| Change actions | One use case per action, each a PEP through the case action enforcement (assignee lock, combined decision with `account.read`, records); the decision request carries the change's context |
| Grant rules | Pure functions in Entitlement's model: days granted in a window (overlaps counted once), what a grant may be (EN-4), the diff and its `test` operations |
| Approvals | A state machine in Support's model (`Pending` → `Approved` / `Denied` / `Expired` / `Canceled`), every transition a conditional update in its transaction (`WHERE approval_status = 'Pending' AND expires_at > now`) |
| The durable process | A timer and a trigger only: the Workflow waits, then calls an application use case (`ApplyApprovedChange` or `ExpireApproval`), which re-reads and decides; the use cases are idempotent |
| Outbox | A row written in the same transaction as the state change; a relay after commit and a sweep deliver it, idempotent by approval id |

## 5. Ports and adapters

| Port | Adapters | Why |
| --- | --- | --- |
| `ChangeRequestRepository` (Support) | PostgreSQL | change requests and approvals |
| `GrantRepository` (Entitlement, extended) | PostgreSQL | create, revoke, extend, record expiry |
| `ApprovalProcess` (application) | Cloudflare Workflows (K1); in-memory for `[http]` and `[use-case]` tests | start an instance, deliver a decision, terminate an instance |
| `TransactionalOutbox` (shared port) | PostgreSQL (`outbox_message`), one deliverer per destination (`approval-process`: the Workflow binding) | messages written in the state change's transaction, delivered after commit and by the sweep, at least once |
| `AuthorizationDecider` (shared) | — | `DecisionRequest` gains `context` and `contactAccountId` |

## 6. Schema and seed

- Support `004`: `change_request` (kind, parameters, diff, `subject_account_version`, status, contact,
  `contact_authenticated_at_confirmation`, requested/confirmed/applied by and at, `created_grant_id`, the
  confirmation's response for idempotency); `change_approval` (status, `expires_at`, decided by and at, reason,
  comment; one per request).
- Application: `outbox_message` (message id, destination, message type, aggregate id, payload of ids and codes,
  created, delivered, attempts, last error), the transactional outbox of every destination.
- Entitlement `00x`: `entitlement_grant` gains `extends_grant_id` and the end reason `Extended` (Q1 B′).
- Account: `account.version` advanced when a change is applied (exists for the version check).
- Seed: emp_morgan / iac_morgan (supervisor, level 2); the reason codes `entitlement.feature-already-included`,
  `entitlement.quota-on-unmetered-feature`, `entitlement.no-subscription`, `support.approval-denied`,
  `support.approval-expired`, `support.stale-change-request` (exists), `support.change-request-not-awaiting-confirmation`.

## 7. Test approach

- `[use-case]` and `[http]` in Node against PostgreSQL, the `ApprovalProcess` an in-memory double that records
  starts, decisions, and terminations; the use cases the Workflow calls are tested directly with the fixed clock.
- `[workflow]` in the Workers runtime through the Wrangler harness (K1): a real Workflow instance with a deadline
  seconds away, a decision event, a lost start repaired by the sweep.
- `[agent]` for the tools and the card, with the scripted model.
- Races (S17a, S26b case C) run concurrently against the real database, repeated.
- Unit tests: the day window, EN-4's rules, the diff, the approval state machine. Mutation checks on the security
  rules: the contact's permission, D5's counting, no self-approval, the window check, the re-run at application.

## 8. Deployment

Neon: Support `004` and the Entitlement migration; the seed adds Morgan (generated password, as the others).
`wrangler.jsonc`: a `workflows` binding (`APPROVAL_PROCESS`, class `ApprovalProcessWorkflow`) and `triggers.crons`
(`*/15 * * * *`). Deploy with IPv4 preferred (case-lifecycle discovery). Smoke test: prepare, confirm, approve as
Morgan, revoke, extend, by script; the approvals panel in the browser.

## 9. Proposed terms

| Term | Meaning |
| --- | --- |
| **Change request card** | The card in the chat drawn from a prepared change request: its kind, parameters, entitlement diff, preview, and Confirm and Cancel |
| **Approvals panel** | The page where a supervisor lists pending approvals and approves or denies them (SU-12) |
| **Approval process** | The durable process of one approval (a Cloudflare Workflow): waits for the decision or the deadline, then has the system apply or expire the change |

## 10. Open questions

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | How is an extension stored? | A: the grant's `expires_at` moves later; the change request and the audit records keep the history. B: an extension row per extension, the grant's end the latest one | A: one grant, one end; history where all history lives (change requests, audit) |
| Q2 | How does the decision reach the waiting process? | A: the decision commits in the database; an outbox row then delivers an event to the Workflow, which calls `ApplyApprovedChange`. B: the endpoint calls the Workflow directly | A: the decision is never lost between the database and the process; the process re-reads before acting |
| Q3 | Where is the approvals panel? | A: a page of the same app, shown to holders of `approval.decide`. B: inside the case panel | A: approvals are outside any case (SU-12) |
| Q4 | How is the 72-hour timer tested? | A: the deadline is a parameter of the instance (`expires_at`); a Workers-runtime test starts one seconds away; the use cases are tested with the fixed clock. B: only the use cases | A: the real timer is exercised once, cheaply |

## 11. Self-review

- Every scenario is turned green by a phase; the Workflow-dependent ones need K1 or its fallback.
- The decision chain change (context, contact) is the riskiest shared change: it touches every decision, so the
  existing 537 tests guard it.
- The approval process holds no rules: every decision is a use case that re-reads, so a duplicate or late wake
  changes nothing.

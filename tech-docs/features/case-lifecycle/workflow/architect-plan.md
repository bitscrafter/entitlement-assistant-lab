# Case Lifecycle — Architect Plan

| | |
| :--- | :--- |
| **Purpose** | How case-lifecycle is built: spikes, phases, ports, adapters, schema, and the scenarios each phase turns green. |
| **Status** | Approved by the owner (2026-10-26), with Q1–Q4 as recommended and the terms of §9 |
| **Feature** | case-lifecycle · S33a–S33k, S27a–S27k, S34a–S34f |
| **References** | • Spec: [`../case-lifecycle.verification-spec.md`](../case-lifecycle.verification-spec.md)<br>• The life of a case: [`../../../diagrams/case-lifecycle.activity.puml`](../../../diagrams/case-lifecycle.activity.puml)<br>• API: [`../../../api/api.md`](../../../api/api.md) §5, §8, §9<br>• Support: [`../../../adr/support.md`](../../../adr/support.md), [`../../../data-model/support.md`](../../../data-model/support.md) |

## Contents

1. [Starting point](#1-starting-point)
2. [Spikes](#2-spikes)
3. [Phases](#3-phases)
4. [Building blocks and styles](#4-building-blocks-and-styles)
5. [Ports and adapters](#5-ports-and-adapters)
6. [Schema](#6-schema)
7. [Test approach](#7-test-approach)
8. [Deployment](#8-deployment)
9. [Terms](#9-terms)
10. [Open questions](#10-open-questions)
11. [Self-review](#11-self-review)

## 1. Starting point

What explain-access already provides:

- `support_case` with subject, contact, authentication, and closing columns, and `case_assignment`
  (migration `support/001`); `OpenCase`, the upgrade route's assignee check (`CaseNotFound`,
  `CaseNotAssigned` security events), and the case agent.
- The PDP pipeline behind `AuthorizationDecider`; Support's read enforcement (permission gate, one audited
  decision, AU-6 disclosure); the four read tools; the reply view with account cards (`reply-details.ts`).
- The `[http]`, `[use-case]`, and `[agent]` harnesses, the latter in the Workers runtime with test controls.

What is missing: the lifecycle use cases and endpoints, a decision that includes `account.read` for a
non-read action (AU-4), governing permissions for lifecycle keys (SU-14), the two new tools, closing an
agent's connections from the Worker, the case panel, and the kind and method of an authentication.

## 2. Spikes

| # | Question | Pass | If it fails |
| --- | --- | --- | --- |
| K1 | Can the Worker, handling `POST …/closure`, make the case's agent close all its connections with `4404 case_unavailable`, through a Durable Object RPC method that is not reachable from any route? | in the Wrangler harness, a closure request closes two open connections with 4404 | the agent closes them itself at its next message or alarm (a check that its case is still assigned); S34b then asserts the close at the next message |

## 3. Phases

| Phase | Name | Work | Scenarios green |
| --- | --- | --- | --- |
| P1 | Schema, harness, RED | Migration `support/002` (§6); the reason codes added to the register; harness Givens: a case with subject, contact, authentication, or closing; a hold on an internal account; an ended role assignment; an account's display name or term changed; then the verification tests (RED gate) | — |
| P2 | Authorization | Governing permissions: `case.set-subject`, `case.set-contact`, `case.authenticate-contact`, `case.close` are held through `case.open` (D11); a decision that includes `account.read` on the account for a non-read action (AU-4, Q1) | — |
| P3 | Support use cases | `CaseAssigneeCheck` (the assignee rule, D9, D10: `NotFound` with its security event); `SetCaseSubject` (conditional update, set once); `SetCaseContact` (a person's own account, clears the authentication); `AuthenticateContact` (kind and method, 30-minute expiry, a failure clears); `CloseCase` (one transaction: close, end the assignment, store the summary); `GetCase` (one read per part, D15); `ListClosedCases` (D17); `ProposeCaseSubject` (a read); the subject rule for the read use cases (D6, Q2) | S33a (use case), S33b–S33e, S33g–S33j, S27a–S27k, S34c–S34f |
| P4 | Endpoints and closing connections | The five case routes and the closed-cases query; strict bodies (`400` with the offending field); `204` for actions; `409 conflict` with its detail; the `CaseWebSocketConnections` port and its Durable Object adapter (K1) | S34b |
| P5 | Agent tools | `propose_case_subject` and `draft_case_summary`; every tool's `result` in snake_case (D13), the reply view and its tests following; the tool set exactly the six of S33k; the subject rule's refusal text (D6) | S33a, S33f, S33k, S34a |
| P6 | Case panel | Left of the chat: subject (holds), contact (holds, roles in the subject), authentication (kind, method, expiry; the form), the close form with the latest draft; **Set as case subject** on a proposed account's card, **Set as contact** on a person's own account; the subject's closed cases; every button calls an endpoint, then re-reads the case (D16) | — |
| P7 | Deploy | Neon migration; deploy; smoke test of every endpoint in the browser and by script; the explain-access live evaluation still owed (discovery 36) runs with it | — |

## 4. Building blocks and styles

| Block | Style |
| --- | --- |
| Case actions | One use case per action, each a PEP (AU-5): the case assignee check first (assignee, D10), then the decision (with `account.read` when an account is involved), then the work in one transaction with its `Succeeded` or `Failed` record (D12) |
| Conflicts | Detected inside the work's transaction: `UPDATE support_case SET subject_account_id = $1 WHERE case_id = $2 AND subject_account_id IS NULL`; no row updated is `subject_already_set` (S33i) |
| Authentication | A value object in Support's model: kind, method, the pairs accepted (D4), `expiresAt = authenticatedAt + 30 minutes` (D5); pure and unit-tested |
| Case view | `GetCase` composes the parts; each part comes from one read decision (D15); the HTTP adapter maps it to the wire shape |
| Tools | Translation only (api.md A1): `propose_case_subject` calls `ProposeCaseSubject`; `draft_case_summary` calls nothing and returns its argument, trimmed and bounded (4,000 characters) |
| UI | The case panel is a component left of the chat; it reads `GET /api/cases/{id}` after every action and after a tool result that proposes or drafts |

## 5. Ports and adapters

| Port | Adapters | Why |
| --- | --- | --- |
| `CaseRepository` (Support, extended) | PostgreSQL | subject, contact, authentication, closing, closed cases by subject |
| `CaseWebSocketConnections` (application) | Durable Object (an RPC method on the case agent), in-memory for `[http]` tests | closing a case closes its agent's WebSocket connections (D7) |
| `AuthorizationDecider` (shared, unchanged) | — | the combined decision is built in Support's PEP from two calls (Q1) |

## 6. Schema

Migration `support/002`:

- `contact_authentication_kind`: values `Knowledge`, `Possession` (the check constraint replaced; no data to
  convert outside tests and the demo, where no case has an authentication).
- `contact_authentication_method`: `SecurityQuestion`, `AccountDetails`, `SupportPasscode`, `OneTimeCode`;
  a check that the method belongs to the kind; the existing all-or-none check extended to the method.
- `case_summary` exists; a check of 1 to 4,000 characters when `closed_at` is set.
- An index for closed cases by subject: `(subject_account_id, closed_at DESC) WHERE closed_at IS NOT NULL`.

Reason codes added to the register (attribution §4a): `support.subject-already-set`,
`support.contact-not-a-person`, `support.contact-not-set`, and the use of `support.contact-authentication-failed`.

## 7. Test approach

- `[http]` and `[use-case]` scenarios run in Node against PostgreSQL, as in explain-access; `CaseWebSocketConnections`
  is the in-memory double there.
- `[agent]` scenarios (S33a, S33f, S33k, S34a, S34b's connections) run in the Workers runtime through the
  Wrangler harness, with the scripted model.
- S33i (two subjects at once) sends both requests concurrently against the real database; the conditional
  update makes exactly one win, and the test is run repeatedly in the phase to catch a lucky pass.
- Unit tests: the authentication value object (kinds, methods, expiry), the combined decision (most
  restrictive, both findings kept), the reply view's snake_case results.
- Mutation checks on the rules that hold security: set once, assignee, the subject rule (D6), the
  readable-part rule (D15), the summary only as submitted.

## 8. Deployment

Neon: run migration `support/002`; no seed change. Deploy the Worker (no new binding; the Durable Object
classes are unchanged). Smoke test by script and in the browser.

## 9. Terms

Ruled by the owner (2026-10-26):

| Term | Meaning |
| --- | --- |
| **Case panel** | The part of the UI left of the chat that shows the case (subject, contact, contact authentication, past cases) and holds every button that changes it; the model can propose, never click (api.md A2) |
| **Case assignee check** | Support's check, before any case action, that the caller is the case's current assignee; otherwise the case answers as a missing one (D10). The WebSocket upgrade applies the same rule |
| **Case WebSocket connections** | The open WebSocket connections of a case's agent, one per browser tab with the case open; the port of the same name closes them all when the case closes (D7) |

## 10. Open questions

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | How does a lifecycle decision include `account.read` (AU-4)? | A: Support's PEP asks the decider twice (the action, then `account.read` on the same account) and combines the two into one decision and one audit record, most restrictive outcome, every finding kept. B: the decider takes a list of actions and runs the pipeline for each | A: the shared port stays as it is; the combination is one small pure function, unit-tested |
| Q2 | Where does the subject rule of D6 live? | A: in Support's read enforcement: a read request carrying a case whose subject is another account is refused (`NotCaseSubject`) before any decision. B: in the tools | A: a rule belongs to the use cases; the tools only translate the refusal |
| Q3 | Where does the drafted summary live? | A: only in the tool result, which the conversation stores; the panel offers the latest draft. B: a draft field in the agent's state | A: nothing new to store or protect, and it survives a reconnect with the conversation |
| Q4 | Order of P5 and P6 | A: as listed. B: the panel first | A: the panel needs the tools' results to offer the buttons |

## 11. Self-review

- Every scenario is turned green by a phase; S34b needs K1 or its fallback.
- No new binding or Durable Object migration: the deploy is a schema migration and a Worker upload.
- The combined decision (Q1-A) changes no audit record already specified by explain-access.
- The snake_case change to `result` touches the explain-access reply view and its unit tests, not its
  verification tests, which assert use-case results.

# API

| | |
| :--- | :--- |
| **Purpose** | Every way into the system: the HTTP endpoints the browser calls, the case agent's WebSocket and its messages, the tools the language model may call, and the use cases behind all three. One error format and one disclosure rule apply to all of them. |
| **Status** | Ruled by the owner (2026-10-25) |
| **References** | • Use cases and their decisions: [`../adr/`](../adr/README.md) (AU-1, AU-4, AU-6, SU-9, SU-12, SU-14, SU-15, CM-5, CM-16, CM-17)<br>• Data model: [`../data-model/README.md`](../data-model/README.md)<br>• Feature specs: [`../features/`](../features/)<br>• Proposal: [`../entitlement-assistant-proposal.md`](../entitlement-assistant-proposal.md) §2, §6, §9 |

## Contents

1. [Decisions](#1-decisions)
2. [Conventions](#2-conventions)
3. [Errors and disclosure](#3-errors-and-disclosure)
4. [Authentication endpoints](#4-authentication-endpoints)
5. [Case endpoints](#5-case-endpoints)
6. [Change request endpoints](#6-change-request-endpoints)
7. [Approval endpoints](#7-approval-endpoints)
8. [The case agent connection](#8-the-case-agent-connection)
9. [Tools](#9-tools)
10. [Use cases by subsystem](#10-use-cases-by-subsystem)
11. [Not addressed](#11-not-addressed)

---

## 1. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| A1 | **Three inbound adapters, one implementation of each use case.** HTTP endpoints (browser), the case agent's WebSocket (chat), and tools (the language model, in-process) call the same use case code. An adapter turns its credential into a principal, chooses which use cases it exposes, and shapes results; it holds no rule. | Hexagonal architecture; no rule is duplicated. In production each adapter is its own namespace with its own restrictions (see §11); MCP is a fourth adapter (proposal §9). |
| A2 | **Anything that changes state and that the language model must not trigger is an HTTP endpoint, never a tool or a WebSocket message:** confirming or canceling a change request, setting the subject, the contact, and contact authentication, reassigning, closing, deciding an approval. | CM-5: the model proposes; only a person's own click acts. |
| A3 | **Tools only read, or prepare.** A preparing tool stores a change request awaiting confirmation (or proposes a subject) and returns a card; it never applies anything. Every effect on a customer traces back to a person's click: the CSR's confirmation, and a supervisor's approval where a policy requires one. | SU-4, SU-9, CM-5. |
| A4 | **Two visible domains: authentication, and the case.** `/api/authentication/…` for who the caller is; every piece of customer work under `/api/cases/{case_id}/…`; approvals on their own, because supervisors decide without being the case's assignee. Entitlements, policies, and subscriptions are not endpoints: the CSR reaches them only within a case. | The CSR's two real contexts. A case in the path makes the assignee check (SU-14) the first check, and every read references its case in the audit record. |
| A5 | **State-changing requests require the application's `Origin`, `Content-Type: application/json`, and the session cookie; every WebSocket upgrade requires the application's `Origin`.** No CORS: no other origin is ever allowed. CORS does not cover WebSockets, so the upgrade is checked by the server. | CSRF and cross-site WebSocket hijacking defense in depth with `SameSite=Strict`. |
| A6 | **Idempotency.** Confirming a change request is idempotent by its id: a repeated confirmation returns the first result. Other actions are guarded by state (closing a closed case answers `409`). | Retries after a dropped response are safe (S17). |
| A7 | **JSON field names, tool names and arguments, WebSocket message payloads, and codes (`error`, a tool's `result`: `found`, `not_entitled`, …) are snake_case; ids are prefixed** (`cse_…`, `chg_…`, `apr_…`, CM-14); instants are RFC 3339 UTC. The TypeScript code stays camelCase; adapters convert at the boundary. | OAuth 2 conventions; one wire format. |
| A8 | **Errors follow the OAuth 2 format** (`error`, `error_description`), with optional `error_details`. The top level is always safe to show to anyone; details appear only when the caller's authentication context allows them (AU-6). | A familiar format whose two levels match the two disclosure levels. |

## 2. Conventions

```text
Base URL           https://app.entitlement-assistant.example
Media type         application/json; charset=utf-8 (requests and responses); no body on 204
Authentication     __Host-session cookie (feature employee-sign-in); no Authorization header
Origin             required on every non-GET request and every WebSocket upgrade; must equal the base URL
Request bodies     at most 16 KiB, read whole before any work; strictly validated: unknown fields, wrong types,
                   and malformed ids are rejected (400)
Ids                kind prefix + 22 base64url characters; a well-formed id of the wrong kind is malformed
Tracing            traceparent accepted; a trace id is created at the edge when absent (attribution §7)
Caching            Cache-Control: no-store on every /api and /agents response
Transport          HTTPS only: plain HTTP is redirected at the edge; Strict-Transport-Security on every response
Examples           JSON is shown formatted; Content-Length is the length of the compact form sent
```

## 3. Errors and disclosure

**Two levels.** The top level (`error`, `error_description`) may be shown to anyone who sent the request,
authenticated or not, so it never reveals anything sensitive: `error_description` is a fixed text per
`error`, never built from data (no ids, names, counts, or states of other resources). `error_details`
appears only when the caller's authentication context allows what it says (AU-6).

```json
{
  "error": "access_denied",
  "error_description": "The request was denied by policy.",
  "error_details": [
    {
      "error": "policy.enterprise-accounts-need-level-2",
      "error_description": "Enterprise accounts need job level 2 or a supervisor."
    }
  ]
}
```

| Status | `error` | `error_description` (fixed) | When | `error_details` |
| --- | --- | --- | --- | --- |
| 400 | `invalid_request` | The request is malformed. | malformed body, unknown field, malformed id | the offending field, only for an authenticated caller |
| 401 | `invalid_session` | A valid session is required. | no session, invalid or expired token, or the principal is no longer valid (CM-16) | never |
| 401 | `invalid_credentials` | The email or password is incorrect. | sign-in failed, for any cause | never |
| 403 | `forbidden` | The request is not allowed. | foreign origin; an action with no subject account refused (opening a case, listing approvals) | never |
| 403 | `access_denied` | The request was denied by policy. | an action on a subject account, refused to a principal who holds `account.read` on it, stopped by a policy | the reason codes, each with its fixed description |
| 403 | `absolute_lifetime_reached` | The session reached its maximum lifetime. | session renewal at the 8-hour cap | never |
| 404 | `not_found` | The resource was not found. | the resource does not exist, **or** the caller may not know it exists: not the case's assignee, no `account.read`, any refusal not covered by `access_denied` | never; byte-identical to a missing resource |
| 409 | `conflict` | The resource is not in a state that allows this request. | change request not awaiting confirmation, approval not `Pending` or past its deadline, case closed, stale change request, subject already set | the state: `stale_change_request`, `case_closed`, `approval_not_pending`, `subject_already_set`, `contact_authentication_failed` |
| 429 | `rate_limited` | Too many requests. Wait a moment, then try again. | the case panel's account search past 20 a minute per employee (case-lifecycle D18) | never |
| 500 | `server_error` | An unexpected error occurred. | anything unexpected, including an audit record that could not be written (fail closed) | never; the trace id in a response header |

**The rule behind the table** (AU-6): a caller learns that a customer account, case, change request, or
approval exists, and why a request was refused, only when they are authenticated and hold the base
permission on it. Every other refusal is `404 not_found`, indistinguishable from absence. A `409` is
reachable only by the case's assignee or an approver, who already know the resource.

## 4. Authentication endpoints

Specified in [`../features/employee-sign-in/`](../features/employee-sign-in/employee-sign-in.verification-spec.md).

| Endpoint | Use case | Success | Errors |
| --- | --- | --- | --- |
| `POST /api/authentication/sign-in` | `SignIn` (Account) | 204 + cookie | 400, 401 `invalid_credentials`, 403 origin |
| `POST /api/authentication/session/renewal` | `RenewSession` (Account) | 204, with a renewed cookie past half-life | 401, 403 `absolute_lifetime_reached` |
| `GET /api/authentication/session` | `GetSessionPrincipal` (Access, over Account's `LoadPrincipal`) | 200 principal: account, display name, job attributes, roles | 401 |
| `POST /api/authentication/sign-out` | `SignOut` (Account) | 204 + cookie cleared (`Max-Age=0`); audit `session.sign-out` | 401 |

```http
POST /api/authentication/sign-out HTTP/1.1
Host: app.entitlement-assistant.example
Origin: https://app.entitlement-assistant.example
Cookie: __Host-session=<token>
Content-Length: 0
```

```http
HTTP/1.1 204 No Content
Set-Cookie: __Host-session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0
```

## 5. Case endpoints

Every endpoint under `/api/cases/{case_id}` answers `404` unless the caller is the case's current assignee
(SU-14), except `reassignment`, which needs `case.reassign`. A closed case has no assignee, so it answers `404`
(case-lifecycle D9). Actions answer `204`; the case panel then reads the case (case-lifecycle D16).

| Endpoint | Use case · action key | Body | Success |
| --- | --- | --- | --- |
| `POST /api/cases` | `OpenCase` · `case.open` | `{}` | 201 `{ case_id }` |
| `GET /api/cases` | `ListMyCases` · none (own assignments only) | — | 200 open cases assigned to the caller |
| `GET /api/accounts?query={query}` | `FindCustomerAccount` · `account.read` per candidate | — | 200 the lookup's answer, as `find_customer_account` gives it (`found`, `ambiguous`); refusals as any read; 400 `query` under 3 or over 320 characters; 429 past 20 a minute (case-lifecycle D18) |
| `GET /api/cases?subject={account_id}&status=closed` | `ListClosedCases` · `account.read` on the account | — | 200 `{ cases }`: the account's closed cases, newest first, at most 20, with reason, closer, and summary (case-lifecycle D17) |
| `GET /api/cases/{case_id}` | `GetCase` · `account.read` on the subject and on the contact, when set | — | 200 case: subject (holds), contact (holds, roles in the subject), authentication (kind, method, expiry); a part the caller may not read shows only its id and `readable: false` |
| `PUT /api/cases/{case_id}/subject` | `SetCaseSubject` · `case.set-subject` | `{ account_id }` | 204 |
| `PUT /api/cases/{case_id}/contact` | `SetCaseContact` · `case.set-contact` | `{ account_id }` | 204 (contact authentication cleared) |
| `POST /api/cases/{case_id}/contact-authentication` | `AuthenticateContact` · `case.authenticate-contact` | `{ kind, method, passed }` | 204, or 409 `contact_authentication_failed` (audited) |
| `POST /api/cases/{case_id}/reassignment` | `ReassignCase` · `case.reassign` | `{ assignee_account_id }` | 200 case |
| `POST /api/cases/{case_id}/closure` | `CloseCase` · `case.close` (without `account.read` on the subject, case-lifecycle D19) | `{ close_reason, summary }` | 204 (pending changes and approvals canceled; open connections closed with `4404`) |

`PUT …/subject` takes the account the assistant proposed (the result of `propose_case_subject`, §9) or one the
CSR picked; the subject is set once, so a second `PUT` answers `409` with `subject_already_set`. A contact
authentication records a `kind` (`Knowledge`, `Possession`) and a `method` (`SecurityQuestion`,
`AccountDetails`; `SupportPasscode` and `OneTimeCode` in production); a password is never a method.

```http
PUT /api/cases/cse_AZK6v3Wr7kq9Yg3hQm2xTA/subject HTTP/1.1
Host: app.entitlement-assistant.example
Origin: https://app.entitlement-assistant.example
Content-Type: application/json
Content-Length: 28
Cookie: __Host-session=<token>

{
  "account_id": "acc_initech"
}
```

## 6. Change request endpoints

Change requests are created by preparing tools (§9) and acted on only here, under their case.

| Endpoint | Use case · action key | Body | Success |
| --- | --- | --- | --- |
| `GET /api/cases/{case_id}/change-requests/{change_request_id}` | `GetChangeRequest` · `account.read` on the subject | — | 200: kind, parameters, stored diff, status, approval |
| `POST /api/cases/{case_id}/change-requests/{change_request_id}/confirmation` | `ConfirmChangeRequest` · `change-request.confirm`, decided under the kind's permission | `{}` | 200 `{ status: Applied }`, 202 `{ status: AwaitingApproval, approval_id }`, or 403 `access_denied` with details |
| `POST /api/cases/{case_id}/change-requests/{change_request_id}/cancellation` | `CancelChangeRequest` · `change-request.cancel` | `{}` | 200 `{ status: Canceled }` |

A repeated confirmation returns the first response (A6). A stale request answers `409` with
`stale_change_request` and ends `Canceled`.

```http
POST /api/cases/cse_AZK6v3Wr7kq9Yg3hQm2xTA/change-requests/chg_AZK6v4b1Qx2r8Kp0sWm9Lg/confirmation HTTP/1.1
Host: app.entitlement-assistant.example
Origin: https://app.entitlement-assistant.example
Content-Type: application/json
Content-Length: 2
Cookie: __Host-session=<token>

{}
```

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
Content-Length: 72

{
  "status": "AwaitingApproval",
  "approval_id": "apr_AZK6v4c7Rt3s1Lm8nXp2Qw"
}
```

## 7. Approval endpoints

The approvals panel (SU-12). Listing needs `approval.decide`; without it the list answers `403 forbidden`
(no subject account is involved), and a decision answers `404`.

| Endpoint | Use case · action key | Body | Success |
| --- | --- | --- | --- |
| `GET /api/approvals?status=Pending` | `ListPendingApprovals` · `approval.decide` | — | 200 pending approvals the caller may decide (never their own requests or confirmations) |
| `POST /api/approvals/{approval_id}/decision` | `DecideApproval` · `approval.decide` | `{ decision, decision_reason?, decision_comment? }` | 200 `{ approval_status }`; 409 with `approval_not_pending` when not `Pending` or past `expires_at` |

`decision` is `Approved` or `Denied`; `Denied` requires `decision_reason`, and `Other` requires
`decision_comment`. An approved change is applied by `sys_approval_process` after the decision (SU-15);
the case is notified through its agent (§8).

## 8. The case agent connection

```text
GET /agents/case-agent/{case_id}    WebSocket upgrade; session cookie; same Origin
                                    101 · 401 · 403 (origin) · 404 (no such case, or not the assignee)
One agent instance (Durable Object) per case, a hardened AIChatAgent (CM-18); the conversation lives in its
storage. The alternative without the Agents SDK: design/case-agent-without-agents-sdk.md.
```

**WebSocket messages from the browser** (chat protocol of the Agents SDK):

| Message | Meaning |
| --- | --- |
| user message | the CSR's text; untrusted, sanitized at entry (proposal §6.2) |
| cancel | stop the current model response |
| stream resume (request, acknowledgement) | resume receiving a response after reconnecting |

Every message is checked for the token's expiry and re-loads the principal (explain-access D6, D10); a user
message is also counted against the rate limit (D13). Any other message is dropped.

**Server WebSocket messages:**

| Message | Meaning |
| --- | --- |
| assistant message (streamed) | the model's text |
| tool call, tool result | shown in the transcript for transparency; results are structured (reason codes, facts) |
| `change_request_card` | `{ change_request_id, change_kind, diff, status }`, rendered from the stored diff, never from model text (SU-9); the UI offers Confirm and Cancel, calling §6 |
| `case_event` | something happened outside the chat: change applied, approval decided or expired, case reassigned or closed |
| close `4401 session_expired` | the token the connection was opened with expired |
| close `4401 invalid_session` | the principal, re-loaded at a message, is no longer active (identity inactive or account suspended) |
| close `1009 message_too_big` | a message from the browser was larger than 16 KiB; the model was not called |
| close `4404 case_unavailable` | the case was closed or reassigned away from the caller |

Cards and buttons are rendered by the UI from tool results and server WebSocket messages; the model can
neither send a message with a different card id nor click a button.

## 9. Tools

Tools are typed functions the model may call; arguments are validated strictly (unknown fields rejected).
The principal and the case always come from the connection, never from arguments. Change tools act on the
case's subject only and fail when it is not set (SU-9). A refusal reaches the model in the same two levels
as §3: details only when the CSR may see them. Every result names its kind in `result`, a snake_case code
(case-lifecycle D13); values that are data (`Allow`, `Payment`) keep their stored spelling. Once a case's
subject is set, the read tools act on it only (case-lifecycle D6).

| Tool | Use case | Arguments | Result | Feature |
| --- | --- | --- | --- | --- |
| `find_customer_account` | `FindCustomerAccount` | `query` (at least 3 characters) | `found`, `ambiguous` (at most 10, with `more_matches`), or a refusal (`not_found`, `access_denied`) | explain-access |
| `check_entitlement` | `CheckEntitlement` | `account_id`, `feature_key` | entitled, quota, sources, reasons, facts | explain-access |
| `list_entitlements` | `ListEntitlements` | `account_id` | entries, or reasons and facts | explain-access |
| `explain_access` | `ExplainAccess` | `person_email`, `account_id`, `feature_key`, `operation` | outcome, findings, remedy | explain-access |
| `propose_case_subject` | `ProposeCaseSubject` · `account.read` | `account_id` | `proposed` with the account as stored; nothing is set; the UI offers **Set as case subject** | case-lifecycle |
| `draft_case_summary` | none | `summary` | `drafted` with the summary; nothing is stored; the case panel offers it for review | case-lifecycle |
| `prepare_change_plan` | `PrepareChangeRequest` (`ChangePlan`) | `target_plan_key`, `coverage_source?`, `duration_days?` | change request id and diff, or refusal | change-subscription |
| `prepare_cancellation` | `PrepareChangeRequest` (`CancelSubscription`) | none | change request id and diff, or refusal | change-subscription |
| `get_account_history` | `GetAccountHistory` · `audit.read` | `limit?` | audit records with actor, participants, outcome, reasons | change-subscription |
| `prepare_grant` | `PrepareChangeRequest` (`CreateGrant`) | `feature_key`, `quota?`, `duration_days`, `reason` | `prepared` with the change request (id, kind, parameters, diff, preview with reasons), or a refusal | grants-and-approvals |
| `prepare_grant_revocation` | `PrepareChangeRequest` (`RevokeGrant`) | `grant_id`, `reason` | as `prepare_grant`; an inactive grant is refused | grants-and-approvals |
| `prepare_grant_extension` | `PrepareChangeRequest` (`ExtendGrant`) | `grant_id`, `duration_days`, `reason` | as `prepare_grant`; an expired grant is refused (prepare a new grant) | grants-and-approvals |
| `prepare_courtesy_term` | `PrepareChangeRequest` (`AddCourtesyTerm`) | `duration_days`, `reason` | change request id and diff, or refusal | candidate S28 |

Preparing runs the decision early so that the card can show a refusal or an approval need before the CSR
confirms; the decision that counts is the one at confirmation (SU-4).

## 10. Use cases by subsystem

Each use case is a PEP (AU-5): authorize through `AuthorizationDecider`, execute, record through
`AuditRecorder` (CM-17).

| Subsystem | Use cases |
| --- | --- |
| Account | `SignIn`, `RenewSession`, `SignOut`, `LoadPrincipal` (internal, used by every authenticated request), `PlaceHold` and `ReleaseHold` (designed), `AdvanceAccountVersion` (internal) |
| Internal Identity | `VerifyEmployeeCredential` (internal, used by `SignIn`), `GetEmployeeProfile` (internal, used by `LoadPrincipal`) |
| Product | `GetCatalog`, `FindLowestPlanIncluding` (remedies, PR-10) |
| Access | `GetSessionPrincipal` (who am I, with roles: roles live in Access, above Account), `LoadPrincipalPermissions` (internal, used by the PIP), `CountSeatsInUse` |
| Entitlement | `ComputeEffectiveEntitlements` (internal), `ChangePlan`, `CancelSubscription`, `CreateGrant`, `AddCourtesyTerm`, `RecordGrantExpiry` |
| Policy | `RegisterPolicySet`, `ActivatePolicySet` (deployment), `EvaluatePolicies` (internal, used by the PDP) |
| Authorization | `Decide` (the PDP, behind `AuthorizationDecider`) |
| Support | `OpenCase`, `ListMyCases`, `GetCase`, `SetCaseSubject`, `SetCaseContact`, `AuthenticateContact`, `ReassignCase`, `CloseCase`, `PrepareChangeRequest`, `GetChangeRequest`, `ConfirmChangeRequest`, `CancelChangeRequest`, `ListPendingApprovals`, `DecideApproval`, `ApplyApprovedChange`, `ExpireApproval`, `FindCustomerAccount`, `CheckEntitlement`, `ListEntitlements`, `ExplainAccess`, `GetAccountHistory` |
| Attribution | `Record` (behind `AuditRecorder`), `VerifyChain` |

The read use cases (`FindCustomerAccount`, `CheckEntitlement`, `ListEntitlements`, `ExplainAccess`,
`GetAccountHistory`) live in Support because they are case work by an employee and depend on Account,
Entitlement, and Authorization below it (CM-15).

## 11. Not addressed

Listed in [`../production-readiness.md`](../production-readiness.md):

- **Adapters as namespaces.** In production each inbound adapter (browser, chat, tools, MCP) is its own
  namespace, with its own credential type, allowed use cases, rate limits, and audit marker; a use case
  can then be allowed through one namespace and refused through another. The demo shares one principal
  across browser, chat, and tools.
- The MCP adapter with OAuth, rate limits per endpoint and per employee, API versioning, pagination beyond
  a fixed limit, and webhooks for external systems.

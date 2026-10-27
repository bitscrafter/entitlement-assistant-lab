# Entitlement Assistant — Product Proposal

|  |  |
| :--- | :--- |
| **Purpose** | What the product does, its guiding principle, its vocabulary, and its scenarios grouped into features. The design of each subsystem lives in the data model and its decisions in the ADRs; this document links to them instead of restating them. |
| **Status** | Ruled by the owner (scope 2026-10-22; aligned with the data model 2026-10-24; review applied 2026-10-25) |
| **References** | • Data model: [`data-model/README.md`](data-model/README.md)<br>• Decisions: [`adr/README.md`](adr/README.md)<br>• Feature specs: [`features/`](features/)<br>• Production concerns: [`production-readiness.md`](production-readiness.md) |

## Contents

1. [Purpose](#1-purpose)
2. [Guiding principle](#2-guiding-principle)
3. [Mapping to the assignment's required components](#3-mapping-to-the-assignments-required-components)
4. [Glossary](#4-glossary)
5. [Where the design lives](#5-where-the-design-lives)
6. [Safety](#6-safety)
7. [Scenarios](#7-scenarios)
8. [Out of scope](#8-out-of-scope)
9. [Decisions](#9-decisions)

---

## 1. Purpose

The Entitlement Assistant is a chat assistant for a **Customer Service Representative (CSR)** of a SaaS
provider. The CSR handles customer cases. The assistant answers questions and makes changes on the
CSR's behalf across five related domains: **authentication, authorization, entitlements, policy, and
subscriptions**.

A CSR using the application can:

- **Sign in** and work through their own internal account. The assistant never acts as anyone else.
- **Find a customer account** in plain language: by account id, account name, or a person's email.
- **Ask about entitlements** in three shapes: *does this account have feature F?* (yes or no, with its
  quota), *what is this account entitled to?* (the full list), and *can this person do this with
  feature F in this account, and why?* (the access explanation).
- **Change a subscription** (upgrade, downgrade, cancel). The assistant prepares a change request and
  shows its effect on entitlements; nothing is applied until the CSR confirms it in the UI.
- **Grant a feature temporarily** (for example, a 7-day grant of audit log export). The grant ends on its own.
- **Escalate**: a change beyond a policy limit becomes **conditional on an approval** that a supervisor
  decides, outside the chat. The case is told the outcome.
- **Review history**: what changed on an account, who asked, who did it, and why it was allowed.
- **Resume a case**: the conversation and its pending change requests survive a page reload.

### Why this problem

It exercises the core concepts of an IAM system in one small product:

- **authentication**: an employee identity, a declared account, a stateless session token
- **authorization**: role-based grants (RBAC) plus attribute-based requirements (ABAC), decided by one chain
- **entitlement computation**: plan + add-ons + grants, covered by subscription terms
- **policy as code**: versioned requirements with explainable outcomes
- **lifecycle**: grants that expire, approvals that wait, holds that suspend accounts
- **attribution**: every decision and change recorded with its actor, participants, and reasons, in a
  tamper-evident chain

---

## 2. Guiding principle

> **The LLM proposes; the policy engine decides.** (CM-5)

- The LLM reads the conversation and selects **tools** with arguments. It never decides whether an
  action is allowed.
- Every tool call is **authorized deterministically** by the authorization decision chain (AU-1). The
  principal is the account named by the verified session token, never text the LLM produced.
- Every **state change** a CSR causes is a **change request** that needs the CSR's confirmation in the
  UI (SU-4). Policy may also make it **conditional on an approval** (PO-3).
- Text from customer records is **untrusted data**. A prompt injection hidden in it can change what
  the LLM *says*, never what the system *allows*.
- Every decision carries machine-readable **reason codes** (AT-5). The LLM turns them into prose; it
  does not invent them.
- **Refusals reveal nothing beyond what the caller may know** (AU-6). Unauthenticated requests get `401`;
  an authenticated employee who may read the account but is stopped by a policy gets `Denied` with
  reasons; anyone else gets `NotFound`, exactly as if the account did not exist.

---

## 3. Mapping to the assignment's required components

| Required component | Cloudflare building block |
| --- | --- |
| LLM | gpt-oss-120b on **Workers AI**, with tool calling (ADR CM-19) |
| Workflow / coordination | One **Agent** (Agents SDK, backed by a Durable Object) per case runs the chat loop. A durable **process instance** (Cloudflare Workflows, behind a port) per approval waits for the decision or its deadline. A scheduled sweep records expired grants. |
| User input via chat | A browser chat UI served as **static assets by the same Worker** that serves the API, streaming over the Agents SDK WebSocket |
| Memory or state | The case conversation in the Agent's embedded SQLite. Everything else (accounts, subscriptions, grants, policies, cases, change requests, the audit chain) in PostgreSQL |

---

## 4. Glossary

A term is used only with the meaning given here or in the document it points to. A term enters the
glossary in the change that first uses it.

### 4.1 Foundational technology

| Term | Meaning |
| --- | --- |
| **Worker** | A Cloudflare Workers function: TypeScript that runs on Cloudflare's network in response to requests. Stateless between requests. Reaches other resources through **bindings**. One Worker serves the chat UI, the sign-in endpoint, and the agent connections. |
| **Binding** | A named handle, declared in the Worker's configuration, through which the Worker reaches a Cloudflare resource (`env.AI`, `env.HYPERDRIVE`). |
| **Durable Object** | A stateful object with a globally unique identity. Each instance runs in one place at a time, handles its requests one after another, and owns private, strongly consistent storage (an embedded SQLite database). It can hold WebSocket connections. |
| **Agents SDK** | Cloudflare's library for building AI agents on Durable Objects. `AIChatAgent` adds a persisted, streaming chat conversation. One instance per case. |
| **Cloudflare Workflows** | Durable, multi-step execution: each step's result is persisted, failed steps are retried, and an instance can wait days for an event or a deadline without consuming resources. Implements our approval process instances. |
| **Workers AI** | Cloudflare's serverless model inference, reached through the `AI` binding. Hosts open models with tool calling; the assistant uses gpt-oss-120b (ADR CM-19). |
| **Hyperdrive** | Cloudflare's connection pooler that lets a Worker use PostgreSQL through a standard driver. |
| **Static assets** | Files (HTML, JavaScript, CSS) that a Worker serves directly. |
| **Wrangler** | Cloudflare's CLI for local development and deployment. |
| **Tool calling** | The LLM's ability to answer with a structured request to call a named function with JSON arguments. |
| **WebSocket** | A long-lived, two-way connection between the browser and the server, opened by one HTTP request (the *upgrade*) and kept open afterwards. The case agent's chat runs over one. |
| **WebSocket message** | One message sent over an open WebSocket, in either direction (RFC 6455). With the Agents SDK each message is a small JSON text, such as `{"type":"cf_agent_use_chat_request", …}`. It is not an HTTP request: it carries no headers and no cookie. |
| **WebSocket frame** | The unit a WebSocket message travels in on the wire (RFC 6455): a message is one or more frames. |
| **Server WebSocket message** | A WebSocket message the server sends to the browser: part of a streamed reply, a tool result, or a close with its code (`4401`, `4404`, …). |
| **Case panel** | The part of the UI left of the chat that shows the case (subject, contact, contact authentication, past cases) and holds every button that changes it; the model can propose, never click (api.md A2). |
| **Case assignee check** | Support's check, before any case action, that the caller is the case's current assignee; otherwise the case answers as a missing one. The WebSocket upgrade applies the same rule. |
| **Case WebSocket connections** | The open WebSocket connections of a case's agent, one per browser tab with the case open; closed together, with `4404 case_unavailable`, when the case closes. |
| **Case event** | One line in a case's conversation that records a lifecycle action taken in the case panel or from a card ("Subject set: «Acme Corp» (Alex, at 15:02)."), written by the server from the action's audit record, never from the browser or the model; the CSR sees it in the timeline, the assistant is told it as a fact (case-lifecycle D21). |
| **Case events delivery** | The port (`CaseEventsDelivery`) through which the application, once an action commits, has the case's agent append the case's events it does not hold yet; a lost delivery is repaired when a connection opens or a turn starts (case-lifecycle D21). |
| **Case state line** | The one-line state of a case the assistant is told at each turn: case number, subject, contact and their roles, contact authentication; accounts the CSR may not read are never named (case-lifecycle D22). |
| **Case account name** | The name of an account as stored when a lifecycle action named it, kept by Support for the case's events, outside the audit chain, which names accounts by id only (AT-7; case-lifecycle D21). |
| **Change request card** | The card in the chat drawn from a prepared change request: its kind, parameters, entitlement diff, preview decision, and Confirm and Cancel (grants-and-approvals D1). |
| **Approvals panel** | The collapsible section at the top of the workspace where a supervisor lists pending approvals and approves or denies them (SU-12; grants-and-approvals D7). |
| **Approval process** | The durable process of one approval (a Cloudflare Workflow): it waits for the decision or the deadline, then has the system apply or expire the change (grants-and-approvals D6). |
| **Transactional outbox** | Messages written in the same transaction as the change they are about, then delivered to their destination at least once, after commit and by a scheduled sweep (`outbox_message`; grants-and-approvals D6). |
| **Outbox message** | One message of the transactional outbox: its destination, type, the id it is about, and a payload of ids and codes only. |
| **MCP (Model Context Protocol)** | An open protocol through which an AI client discovers and calls tools exposed by a separate server. |
| **JWT (JSON Web Token)** | A compact, signed token carrying claims; verifiable without a database lookup. |
| **CEL (Common Expression Language)** | A side-effect-free, type-checked expression language; used for policy predicates. |
| **W3C Trace Context** | The standard `traceparent` header that carries a trace id across services. |

### 4.2 Product terms

| Term | Meaning |
| --- | --- |
| **CSR** | Customer Service Representative: the everyday name for an employee in the `customer-support` department. Not an entity. |
| **Assistant** | The AI part of the application: the LLM plus its tools. |
| **Tool** | A typed function the assistant may call. Each tool maps to one use case, which asks the authorization decision chain before acting. |
| **Access explanation** | The answer to "why can or can't this person do this with feature F in this account": the decision for that action, with every reason code and the facts behind it. |
| **Remedy** | For a feature an account lacks: the lowest-ranked plan of its plan ladder that includes it, and the eligible add-ons that do. |
| **Case agent** | The Durable Object of one case, built on the Agents SDK's `AIChatAgent` with a WebSocket message guard in front of it (CM-18): it serves every WebSocket connection to the case, runs the language model and the tools, and keeps the case conversation. The alternative without the Agents SDK is described in [`design/case-agent-without-agents-sdk.md`](design/case-agent-without-agents-sdk.md). |
| **Case conversation store** | Where a case agent keeps its conversation: the Agents SDK's message storage, written only with what the WebSocket message guard builds, never with a client's messages. |
| **Connection session** | What the server keeps for one case agent connection: the principal's account, the session id, and the expiry of the token it was opened with; never writable by the client. |
| **Inbound guard** | A check an inbound adapter runs on input before any use case is reached: it decides only whether the input may enter (origin, session, size, rate, shape), never what a principal may do, which is the authorization decision's. There are two: the HTTP request guard and the WebSocket message guard. |
| **HTTP request guard** | The inbound guard of every HTTP request, the WebSocket upgrade that opens a case agent connection included: the HTTPS redirect, the application's origin, the session token, and the principal loaded fresh (`application/…/src/http/request-guard.ts`). |
| **WebSocket message guard** | The inbound guard of every WebSocket message a browser sends to a case agent once the connection is open, before the Agents SDK sees it: size, kind, rate, the token's expiry, and the principal; a chat request is rebuilt from the stored conversation and the newest message's text, and every other message that could write the conversation, a tool result, or the agent's state is dropped (`application/…/src/agent/websocket-message-guard.ts`). |
| **Message rate limiter** | Counts an employee's chat messages over a sliding minute and refuses past the limit (port `MessageRateLimiter`). |
| **Permission gate** | The first step of every read: a decision on the principal's permission alone, before any customer data is read. |
| **Policy expression evaluator** | Parses, type-checks, and evaluates a policy's predicates (port `PolicyExpressionEvaluator`). |
| **Scripted language model** | The test double of the language model: the AI SDK's mock model, answering with scripted text and tool calls. |

### 4.3 Terms defined with their subsystem

| Terms | Defined in |
| --- | --- |
| Customer, organization, individual, organization membership | [`data-model/customer-identity.md`](data-model/customer-identity.md) |
| Internal identity, employee, system identity, department, job function, job level, employee credential | [`data-model/internal-identity.md`](data-model/internal-identity.md) |
| Principal, account, account kind, customer account, account category, internal account, account status, account hold | [`data-model/account.md`](data-model/account.md) |
| Permission, role, principal kind, account role assignment, birthright role assignment, internal role and permission assignments, account context | [`data-model/access.md`](data-model/access.md) |
| Product, feature, feature operation, metered unit, plan ladder, plan, tier rank, add-on, bundle, quota, add-on eligibility | [`data-model/product.md`](data-model/product.md) |
| Subscription, subscription term, term source, entitlement grant, effective entitlements, seats in use | [`data-model/entitlement.md`](data-model/entitlement.md) |
| Case, subject account, contact, contact authentication, case assignment, change request, change approval, entitlement diff, case summary | [`data-model/support.md`](data-model/support.md) |
| Audit record, actor, participant, action, action key, audit outcome, reason code (and its register), audit chain, audit checkpoint | [`data-model/attribution.md`](data-model/attribution.md) |
| Policy, governed action, requires and applies-when predicates, optional attribute, unmet outcome, prerequisite, policy set, policy set version, activation | [`data-model/policy.md`](data-model/policy.md) |
| Authorization decision, finding | [`adr/authorization.md`](adr/authorization.md) |

**Actions and permissions.** Every permission names an action; not every action has a permission.
Session and lifecycle events (`session.sign-in`, `change-request.confirm`) are action keys only, each
governed by a named permission. The closed list of action keys is Access's action registry
([`data-model/access.md`](data-model/access.md) §2). Roles give permissions; policies only constrain.

### 4.4 Authorization architecture

| Term | Standard meaning | In this design | Used by |
| --- | --- | --- | --- |
| **PEP** (Policy Enforcement Point) | Intercepts a request, asks for a decision, enforces it | each subsystem's **use cases**, through one shared template (authorize, execute, audit) | every use case, before reading or changing |
| **PDP** (Policy Decision Point) | Computes the decision | **Authorization**: the pipeline of handlers (AU-1) | the PEPs |
| **PIP** (Policy Information Point) | Supplies the attributes | **Authorization** loads principal and resource; the use case passes a typed context (AU-5) | the PDP |
| **PAP** (Policy Administration Point) | Where policies are authored and managed | the **policy files** under version control, and their registration and activation at deployment (Policy) | authors, the deployment |
| **PRP** (Policy Retrieval Point) | Where the PDP gets the active policies | the **policy set bundled into the Worker**, checked against the active set (Policy) | the PDP |

---

## 5. Where the design lives

| Topic | Documents |
| --- | --- |
| Architecture and code structure | [`../AI_AS_ARCHITECT.md`](../AI_AS_ARCHITECT.md), CM-1, CM-13 |
| Data model, per subsystem | [`data-model/README.md`](data-model/README.md) |
| Endpoints, agent connection, tools, use cases | [`api/api.md`](api/api.md) |
| Decisions | [`adr/README.md`](adr/README.md) |
| Authentication and sessions | CM-3, CM-16, AN-5; [`diagrams/sign-in.sequence.puml`](diagrams/sign-in.sequence.puml) |
| The authorization decision | AU-1 to AU-6; [`diagrams/authorization-decision.activity.puml`](diagrams/authorization-decision.activity.puml) |
| Production concerns not addressed | [`production-readiness.md`](production-readiness.md) |

---

## 6. Safety

### 6.1 Provenance of prompt content

| Provenance | Example | Trust |
| --- | --- | --- |
| System | instructions, tool definitions | trusted |
| CSR | the authenticated CSR's messages | trusted as a *request*, still authorized |
| Tool result | account data from the database | **data**: never instructions |
| Customer-supplied text in a tool result | notes, display names | **untrusted** |

Tool results are structured JSON in tool messages. Customer-supplied free text is wrapped and labeled as
untrusted, and tools return only the fields a question needs.

### 6.2 Sanitizing at entry

Fields are validated at write time (type, length, allowed characters). Free text cannot be reliably
cleaned of instructions, because an injection is ordinary language; a classifier (for example, Llama
Guard on Workers AI) can flag suspicious text, but detection is probabilistic. **The control is §2: the
LLM has no authority to lose.**

### 6.3 Confirmation, idempotency, and attribution

Change requests are confirmed in the UI, applied exactly as shown and at most once (SU-4), and every
decision and change is recorded in the audit chain (AT-3, AT-4).

---

## 7. Scenarios

Scenarios are grouped into **features**; each feature is cohesive and deployable on its own, and its
authoritative statement is its verification spec. Scenario ids (S01, S02, …) are stable across documents.
Features are built in the order listed; each depends on the ones before it. Grants and approvals come before
plan changes (owner, 2026-10-26): a grant is the simplest change, and an approval waited on by a durable
process covers the assignment's workflow component; it carries the change-request core (S15, S17, S18).

| Order | Feature | Scenarios | Depends on | Spec |
| --- | --- | --- | --- | --- |
| 1 | employee-sign-in | S01–S03, S04a–S04f | — | [`features/employee-sign-in/employee-sign-in.verification-spec.md`](features/employee-sign-in/employee-sign-in.verification-spec.md) |
| 2 | explain-access | S05a–S13 | employee-sign-in | [`features/explain-access/explain-access.verification-spec.md`](features/explain-access/explain-access.verification-spec.md) |
| 3 | case-lifecycle | S27, S33, S34 | explain-access | [`features/case-lifecycle/case-lifecycle.verification-spec.md`](features/case-lifecycle/case-lifecycle.verification-spec.md) |
| 4 | grants-and-approvals | S15, S17, S18, S21–S26, S38, S39 | case-lifecycle | [`features/grants-and-approvals/grants-and-approvals.verification-spec.md`](features/grants-and-approvals/grants-and-approvals.verification-spec.md) |
| 5 | change-subscription | S14, S16, S16a, S16b, S19, S20 | grants-and-approvals | planned |
| — | candidate features | S28–S32 | — | — |

The seeded dataset is the one in the explain-access spec: customers Acme, Acme Labs, Initech, Globex,
Hooli, Wayne, Stark, Umbrella, their people, three employees (Alex, Blair, Sam), two system identities, the
catalog of the `standard` plan ladder, and the starting policy set.

### Feature employee-sign-in

| Id | Scenario |
| --- | --- |
| S01 | An employee signs in; the session acts as their internal account. |
| S02 | Sign-in is rejected without revealing which part was wrong. |
| S03 | A request without a valid session token is rejected. |
| S04a | Renewal before half-life changes nothing. |
| S04b | Renewal past half-life re-issues the token in the same session. |
| S04c | Renewal is capped by the absolute lifetime. |
| S04d | Renewal is refused once the token ends at the absolute lifetime. |
| S04e | An expired token cannot be renewed. |
| S04f | Renewal re-checks the principal. |

### Feature explain-access (read-only)

| Id | Scenario |
| --- | --- |
| S05a | Opening a case assigns it to the opener. |
| S05b | Opening a case without the permission is refused. |
| S05c | Opening a case from a foreign origin is refused. |
| S05d | Opening a case without a session is refused. |
| S05e | The assignee connects to their case. |
| S05f | A case that is not the caller's, or does not exist, is not found. |
| S05g | A connection from a foreign origin is refused. |
| S05h | A connection without a valid session is refused. |
| S05i | The server closes an agent connection when its session token expires. |
| S05j | Renewing the cookie does not extend an open connection. |
| S06a | An identity claim in the message carries no authority. |
| S06b | An identity claim in tool arguments is rejected. |
| S07a | An account is found by id or by name. |
| S07b | A query matching several accounts lists every authorized candidate. |
| S07c | A candidate denied by a policy is left out. |
| S07d | No match, and no authorized match, look the same. |
| S08a | A level-1 representative is denied an Enterprise account. |
| S08b | Level 2 and supervisors may read an Enterprise account. |
| S08c | Without `account.read`, an Enterprise account looks like a missing one. |
| S08d | Checks, lists, and explanations include the same `account.read` finding. |
| S08e | Checks and lists without `account.read` look like a missing account. |
| S09a | A check finds the feature with its sources. |
| S09b | A check explains why the feature is missing. |
| S10a | A list shows every effective entitlement with its sources. |
| S10b | A list with nothing effective says why. |
| S11 | Explain why a person can use a feature in an account. |
| S12 | Explain why a person cannot, with every reason and a remedy. |
| S13 | A case resumes after reconnecting, without re-running tools. |

### Feature case-lifecycle

| Id | Scenario |
| --- | --- |
| S33 | **Set the case's subject**: proposed by the assistant, confirmed by the CSR in the UI, audited (`case.set-subject`). |
| S27 | **Contact authentication**: the CSR records how the contact was authenticated; changes for an unauthenticated contact are denied (`policy.contact-is-authenticated`). |
| S34 | **Close a case**: pending change requests and approvals are canceled; the case summary is drafted and reviewed. |

### Feature grants-and-approvals

| Id | Scenario |
| --- | --- |
| S15 | **Change request canceled** by the CSR, or by closing the case: nothing changes. |
| S17 | **Confirmation is idempotent**: confirmed twice, applied once. |
| S18 | **The LLM cannot apply a change**: a state-changing tool only creates a change request. |
| S21 | **Grant within 14 days**: allowed; the grant belongs to the subscription and ends on its own. |
| S22 | **Grant expires**: ignored from its expiry instant; `sys_grant_expiry` records the end. |
| S23 | **Grant beyond 14 days**: `Conditional` on an approval (`policy.grants-up-to-14-days`); a process instance waits. |
| S24 | **Supervisor decides** in the approvals panel: approved, the confirmer's decision re-run, the stored diff re-checked, and the change applied by `sys_approval_process` (SU-15); or denied with a decision reason. The case is notified. |
| S25 | **No self-approval**: neither the requester nor the confirmer may decide (`policy.no-self-approval`). |
| S26 | **Approval expires**: the approval and the change request become `Expired`; the case is notified. |

### Feature change-subscription

| Id | Scenario |
| --- | --- |
| S14 | **Plan change with confirmation** (table-driven): an upgrade to a `Paid` plan with `Trial` coverage, a downgrade to the `Free` plan, and a cancellation (`CancelSubscription`, with an authenticated contact). Each change request shows its entitlement diff; after confirmation it is applied, effective entitlements change, and the audit chain records it. A target equal to the current plan is refused (`entitlement.plan-unchanged`). |
| S16 | **Change request refused** (table-driven): the CSR lacks the permission (`access.permission-not-held`); the subject account is suspended (`account.operational-suspension`); the downgrade does not fit the seats in use (`policy.downgrade-fits-seats`); the contact lacks the customer permission (`access.contact-permission-not-held`); the contact is not authenticated (`policy.contact-is-authenticated`); the coverage exceeds 14 days (`policy.trial-coverage-up-to-14-days`); the CSR is not the case's assignee (`support.not-case-assignee`). |
| S16a | **Stale change request**: the subject account changed after the request; it ends `Canceled` (`support.stale-change-request`) and a fresh one is prepared. |
| S16b | **Upgrade beyond Pro, or a cancellation, without a contact** is `Conditional` on an approval (`policy.upgrade-beyond-pro-needs-contact-or-approval`, `policy.cancel-needs-contact-or-approval`). |
| S19 | **Prompt injection in customer data has no authority.** |
| S20 | **Account history** (`audit.read`, behind the `account.read` gate): audit records with actor, participants, outcome, and reason codes. |

### Candidate features

| Id | Scenario |
| --- | --- |
| S28 | **Courtesy term**: a CSR adds up to 14 days of coverage (`subscription.add-courtesy-term`, `policy.courtesy-up-to-14-days`). |
| S29 | **Change a person's role in an account** (`role-assignment.create`, justified by membership). |
| S30 | **"What am I allowed to do?"**: the assistant lists the CSR's permissions and the policies that constrain them. |
| S31 | **MCP server**: the same use cases exposed to external AI clients, behind OAuth. |
| S32 | **Voice input**: speech transcribed by Workers AI and handled as typed input. |

---

## 8. Out of scope

- Payments: billing's only interface is adding `Payment` terms and canceling subscriptions (EN-10).
- Customers signing in to this application; a customer self-service portal.
- Federation protocols (SAML, OIDC, SCIM).
- A policy editing UI (policies are versioned files, PO-5).
- Notifications outside the application.
- Token revocation before expiry (CM-3).

Production concerns are collected in [`production-readiness.md`](production-readiness.md).

---

## 9. Decisions

The architectural decisions are ADRs in [`adr/`](adr/README.md). Product-level rulings by the owner:

| Decision | Ruling |
| --- | --- |
| Naming (2026-10-22) | The human is the **CSR**; the AI is the **assistant**. |
| Product name (2026-10-25) | **Entitlement Assistant** (`entitlement-assistant`): "agent" read as the human support agent; the AI is the assistant. |
| Scope (2026-10-22) | Build in features; sign-in and explain access first. |
| Process (2026-10-22) | A slimmed-down version of the working constitution. |
| Tools (2026-10-25) | Tool calling in the demo; MCP in production (see below). |
| API (2026-10-25) | Two visible domains, authentication and the case; OAuth 2 error format with details only when the caller may see them; snake_case on the wire ([`api/api.md`](api/api.md)). |
| Prompt history (2026-10-25) | Published at the end, redacted, in a folder under `tech-docs/`. |
| Repository remote (2026-10-25) | Created once the work is done. |
| Design order (2026-10-23) | Data model per subsystem, then the policy model, then APIs, then scenarios (sign-in first). |

**Tool calling versus MCP (owner, 2026-10-25).** The demo uses tool calling in-process: tools and use
cases live in the same Worker, so there is no extra network hop or authentication boundary. A production
system exposes the same use cases through MCP, behind OAuth, as another inbound adapter (S31); the use
cases, their authorization, and their audit do not change.

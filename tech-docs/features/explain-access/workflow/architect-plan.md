# Explain Access — Architect Plan

| | |
| :--- | :--- |
| **Purpose** | How explain-access is built: spikes, phases, ports, adapters, schema, and the scenarios each phase turns green. |
| **Status** | Approved by the owner (2026-10-25), with every recommendation of §10 and the terms of §9; self-reviewed (demo mode) |
| **Feature** | explain-access · S05a–S05m, S06a–S06b, S07a–S07d, S08a–S08e, S09a–S09b, S10a–S10b, S11, S12, S13 |
| **References** | • Spec: [`../explain-access.verification-spec.md`](../explain-access.verification-spec.md)<br>• Sequence: [`../../../diagrams/agent-connection.sequence.puml`](../../../diagrams/agent-connection.sequence.puml)<br>• API: [`../../../api/api.md`](../../../api/api.md) §5, §8, §9, §10<br>• Structure: [`../../../../AI_AS_ARCHITECT.md`](../../../../AI_AS_ARCHITECT.md)<br>• Decisions: AU-1 to AU-6, PO-1 to PO-6, EN-6, PR-10, SU-14, CM-15, CM-17 in [`../../../adr/`](../../../adr/README.md) |

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

---

## 1. Starting point

Employee-sign-in built Internal Identity, Account (internal accounts and holds), Access (employee roles),
Attribution, and the HTTP pipeline. This feature adds everything a read needs:

| Subsystem | Exists | This feature adds |
| --- | --- | --- |
| Customer Identity | — | customers, organizations, individuals, memberships; lookup by email |
| Account | internal accounts, holds, `LoadPrincipal` | customer accounts; principals for individuals (explanations, D5) |
| Product | — | the catalog; `GetCatalog`, `FindLowestPlanIncluding` (PR-10) |
| Access | employee roles, birthright | feature permissions, account role assignments, `LoadPrincipalPermissions`, the action registry |
| Entitlement | — | subscriptions, terms, add-ons, grants; `ComputeEffectiveEntitlements` (EN-6) |
| Policy | — | policy files, CEL evaluation, set version, registration and activation |
| Authorization | — | the PDP pipeline (AU-1), findings and decisions (AU-2), the PIP; `AuthorizationDecider` |
| Support | — | cases and assignments; `OpenCase`, `FindCustomerAccount`, `CheckEntitlement`, `ListEntitlements`, `ExplainAccess`; the PEP template |
| Application | HTTP pipeline, sign-in endpoints, UI | `POST /api/cases`, the case agent and its tools, the rate limiter, the chat UI |

None of the agent stack is installed yet: the Agents SDK (`agents`), the AI SDK (`ai`), the Workers AI
provider, `@cloudflare/vitest-pool-workers`, and a CEL library.

## 2. Spikes

Three questions decide how the riskiest parts are built. Each spike is time-boxed, writes only throwaway code
outside `typescript/system/`, and ends with a recorded outcome (`discoveries.md`) before any phase starts.

| # | Question | Pass | If it fails |
| --- | --- | --- | --- |
| K1 | Does a CEL library parse, type-check, and evaluate the starting policy set in the Workers runtime (no `eval`, no `new Function`)? | every expression of `policy.md` §5 type-checks against the attribute schema and evaluates in `workerd` | our own parser for the same subset (PO-4's fallback): comparisons, `&&`, `\|\|`, `!`, `has()`, string and integer literals |
| K2 | Can a verification test drive a real case agent (a Durable Object built on `AIChatAgent`) over a WebSocket with a scripted model, against the Docker PostgreSQL, using `@cloudflare/vitest-pool-workers`? | a test opens a WebSocket to a Durable Object, sends a message, receives the scripted reply, and the agent reads a row from the test database | Q1 in §10 |
| K3 | Does Workers AI's Llama 3.3 70B call our tools through the AI SDK with the arguments the tool schemas require? | the four messages of the spec's §5 produce the expected tool calls at least once each | record the pass rate; the feature does not depend on it (report-only, spec §5) |

## 3. Phases

Each phase compiles and leaves the tree green except for the scenarios still owed. The RED gate runs after
P1: every verification test written from the spec, every one failing for the reason it predicts.

| # | Phase | Delivers | Scenarios green |
| --- | --- | --- | --- |
| P1 | Schema, seed, harness | Migrations for Customer Identity, customer accounts, Product, Access (feature permissions, account role assignments), Entitlement, Policy, Support (cases and assignments); the layer order extended; the catalog and customer fixtures of spec §2 in the seed; the foreign-key test over the new tables; the test harness for `[use-case]` and `[agent]` entry points; then the verification tests (RED gate) | — |
| P2 | Product and Entitlement | Catalog model and loading rules (PR-1…10); `ComputeEffectiveEntitlements` as one pure building block over a loaded account snapshot (EN-6): holds, subscription, covering term, bundles, add-ons, grants ignoring expired ones, quotas summed, every source listed; `FindLowestPlanIncluding` for remedies | — |
| P3 | Policy | Policy files for the starting set; the attribute schema; CEL evaluation behind `PolicyExpressionEvaluator` (K1's outcome); build-time type check; set version (SHA-256 of canonical JSON); `EvaluatePolicies` (PO-3 combination); registration and activation commands; the Worker's active-set check, fail closed; the policy case files and their suite (PO-6) | — |
| P4 | Authorization | `AuthorizationDecider` port; the PDP pipeline (account, access, contact access, entitlement, policy handlers; every handler runs, AU-1); findings and the most-restrictive combination (AU-2); the PIP loading principal attributes fresh (employees and individuals) and resource attributes; the PEP template in Support: permission gate first (D12), then the full decision, then the work, then exactly one audit record (AT-3) | — |
| P5 | Support use cases and the case endpoint | `OpenCase` with `POST /api/cases`; `FindCustomerAccount` (email, `acc_` id, display-name fragment; one decision per candidate; denied candidates left out; AU-6 mapping; no-match record with the query's HMAC); `CheckEntitlement`; `ListEntitlements`; `ExplainAccess` (the person's account decided as principal through the same pipeline, D5; remedy, PR-10) | S05a–S05d, S07a–S07d, S08a–S08e, S09a–S09b, S10a–S10b, S11, S12 |
| P6 | Case agent | The upgrade route (D9 origin, session, principal, assignee: `CaseNotFound` and `CaseNotAssigned`, D1); the case agent (a Durable Object per case, on `AIChatAgent`); the connection session kept server-side; the message pipeline in its fixed order (size D11, rate D13, expiry D6, principal D10); the expiry timer; the four tools with strict schemas, calling the use cases with the connection's principal; `LanguageModel` with the Workers AI adapter and the scripted double; `MessageRateLimiter` with its Durable Object adapter | S05e–S05m, S06a–S06b, S13 |
| P7 | Chat UI | Open a case, chat, show tool calls and results, escaped rendering under the existing CSP; reconnect after `4401 session_expired` with the renewed cookie; back off after `4429` | — |
| P8 | End to end and deploy | The automated end-to-end test through the Workers runtime (sign-in discovery 8); `wrangler.jsonc`: Durable Object classes and their migration, the Workers AI binding; Neon: migrate, seed, register and activate the policy set; deploy; smoke test; the live-model evaluation (spec §5, report-only) | — |

Every scenario lands in exactly one of P5 or P6. P2–P4 are covered by unit and functional tests; their
scenarios turn green when P5 connects them.

## 4. Building blocks and styles

| Concern | Building block | Style and why |
| --- | --- | --- |
| Effective entitlements | `entitlement/src/model/effective-entitlements.ts`: `computeEffectiveEntitlements(snapshot, instant)` → entitlements with sources and quotas, or the stopping reasons with facts | Pure function over a value object loaded by one repository; the only place the rule lives (EN-6) |
| Remedy | `product/src/model/remedy.ts`: lowest plan of the ladder including the feature; add-ons including it with their eligible plans | Pure function over the catalog (PR-10) |
| Decision | `authorization/src/model/decision.ts`: findings → most restrictive outcome, all reasons, all obligations | Value objects; the combination rule in one place (AU-2) |
| PDP | `authorization/src/usecase/decide.ts`: an ordered list of handlers, each adding findings | Pipeline of handlers, a Chain of Responsibility variant in which every handler runs (AU-1); a new handler is a new strategy, not an edit |
| PEP | `support/src/usecase/enforce.ts`: permission gate, decision, work, audit record | Template Method: each read use case supplies its subject, its context, and its work; the order cannot be skipped (AU-5) |
| Disclosure | `support/src/model/disclosure.ts`: a decision and whether the principal holds `account.read` → `Allowed`, `Denied(reasons)`, or `NotFound` | One mapping for every refusal (AU-6, D3) |
| Account lookup | `support/src/usecase/find-customer-account.ts` with a query classifier in the model (email, account id, name fragment) | Strategy per query kind; deduplicated candidates |
| Policy evaluation | `policy/src/model/combine-policies.ts` (PO-3); expressions through the `PolicyExpressionEvaluator` port | Strategy behind a port: the evaluator can be replaced (CEL library, our parser, Cedar) with the case files as its conformance suite |
| Message pipeline | `application/…/src/agent/message-gate.ts`: size, rate, expiry, principal, in that order, each a step returning continue or a close frame | Pipeline; the order is the spec's (D6, D10, D11, D13) and is tested once |
| Tools | `application/…/src/agent/tools.ts`: one strict schema per tool, each calling one use case | Inbound adapter: translation only, no rule (A1) |

## 5. Ports and adapters

| Port (shared `port/` unless noted) | Adapters | Conformance suite |
| --- | --- | --- |
| `AuthorizationDecider` (CM-17) | the PDP in Authorization | decision-chain tests over the seeded data |
| `LanguageModel` | `WorkersAiLanguageModel` (AI SDK with the Workers AI provider); `ScriptedLanguageModel` (tests) | both stream text and tool calls in the same event shape |
| `MessageRateLimiter` | `DurableObjectMessageRateLimiter` (one object per employee account, on the `Clock` port); `InMemoryMessageRateLimiter` (unit tests) | 20 allowed per minute, the 21st refused, the window slides with the clock |
| `PolicyExpressionEvaluator` (Policy's `usecase/`) | the CEL adapter chosen by K1 | the policy case files (PO-6) |
| `IdentifierHasher` (exists) | `HmacIdentifierHasher` (exists): the lookup query's HMAC | exists |
| Repositories (each subsystem's `usecase/`) | one PostgreSQL adapter each: customers, customer accounts, catalog, role assignments, subscriptions with terms, add-ons and grants, policy sets, cases | functional tests against Docker PostgreSQL |
| `SecurityEventLog` (exists) | causes `CaseNotFound` and `CaseNotAssigned` added | exists |

## 6. Schema and seed

- **Layer order** (CM-15): customer-identity, internal-identity, account, product, access, entitlement, policy,
  support, attribution. Authorization has no tables.
- **Tables** as each subsystem's data model states. Support creates only `support_case` and
  `case_assignment`; change requests and approvals come with change-subscription.
- **Privileges** (CM-7, CM-13): no `DELETE` anywhere; policy tables `INSERT` and `SELECT` only.
- **Seed:** the catalog and the employee and customer roles join `reference-data.yaml`; customers, accounts,
  memberships, role assignments, subscriptions, terms, add-ons, grants, and holds of spec §2 join
  `fixtures.yaml`. The cases of spec §2 are test fixtures, not seed data (Q3).
- **Dates:** the fixture's terms are fixed dates around 2026-10-22, as the spec states. A deployed database
  queried today sees them as they would be on that day's real clock: some lapsed, some current (Q4).

## 7. Test approach

| Level | How it runs |
| --- | --- |
| `[use-case]` | Node and Vitest, as employee-sign-in: the use cases from the composition root, a fixed clock, a fresh database cloned from the seeded template |
| `[http]` | Node and Vitest through `createApplication(…).fetch`, as employee-sign-in; the upgrade route answers its refusals (401, 403, 404) there; the `101` handshake needs the Workers runtime |
| `[agent]` | depends on K2 and Q1: the Workers test pool, a real Durable Object, a WebSocket, the scripted model, the test database |
| End to end | the Worker started through Wrangler's API in a test: sign in, open a case, connect, one scripted chat turn |
| Live model | spec §5, report-only, never in the gate |

Each verification test is one scenario (`AI_AS_TESTER.md`); cases are `test.each` rows. D12 is asserted twice:
the verification tests check the audit record (no subject for a lookup, only `access.permission-not-held`); a
Support functional test replaces Account's and Entitlement's ports with doubles that fail when called, so
reading any customer data on the refused path fails the test.

## 8. Deployment

- `wrangler.jsonc`: the Durable Object classes (case agent, rate limiter) with a `new_sqlite_classes`
  migration, and the `AI` binding.
- **Scope check:** a deploy with Durable Objects and a Workers AI binding may need more than
  `workers:write`. Checked with `wrangler deploy --dry-run` and the first deploy; a missing scope goes to the
  owner, as with Hyperdrive.
- Neon: migrations, seed with the generated passwords (existing), policy set registration and activation.

## 9. Proposed terms

| Term | Meaning | Where |
| --- | --- | --- |
| **Message rate limiter** | Counts an employee's chat messages over a sliding minute and refuses past the limit (D13) | port `MessageRateLimiter` |
| **Connection session** | What the server keeps for one agent connection: the principal's account, the session id, and the token's expiry; never writable by the client | the case agent |
| **Permission gate** | The first step of the PEP template: a decision on the principal's permission alone, before any customer data is read (D12) | Support's PEP template |
| **Policy expression evaluator** | Parses, type-checks, and evaluates a policy's predicates | Policy port `PolicyExpressionEvaluator` |
| **Scripted language model** | The test double of `LanguageModel` that answers with scripted text and tool calls (spec: "the scripted double") | tests |

## 10. Open questions

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | If K2 fails, how are `[agent]` scenarios run? | A: the agent's message handling as a plain class driven in Node through a test connection, with the Durable Object a thin adapter covered by the end-to-end test. B: keep the Workers pool, with PostgreSQL reached through a local Hyperdrive or a test-only HTTP bridge | A: it keeps every scenario in the fast gate; the real WebSocket path is still proven end to end |
| Q2 | Policy set registration and activation, and the Worker's active-set check: in this feature? | A: yes, with commands run at deploy and the check failing closed. B: bundle the set and record its version, defer registration and activation | A: PO's fail-closed guarantee and the audit records' `policy_set_version` both rely on it |
| Q3 | Are the spec's cases seeded? | A: test fixtures only; production starts with no cases. B: seeded | A: a case belongs to a real CSR's work |
| Q4 | Fixture dates on the deployed demo | A: keep the spec's fixed dates; the live demo shows some terms lapsed as time passes. B: a deploy-time option that shifts every fixture date so that 2026-10-22 maps to the seeding day | B: the live demo then shows what the spec describes; the tests keep fixed dates |
| Q5 | Size | A: one feature, as approved. B: split after P5 (reads through the use cases and HTTP), with the case agent as its own feature | A: the spec is approved as one feature, and P5 already gives a checkpoint with most scenarios green |

## 11. Self-review

| Check | Result |
| --- | --- |
| Every scenario lands in a phase | S05a–S05d, S07–S12 in P5; S05e–S05m, S06a–S06b, S13 in P6 |
| Any arrow pointing outward, any rule in an adapter | none planned: tools and endpoints translate only; dependency-cruiser guards it |
| Any algorithm in two places | effective entitlements, the decision, the policy combination, disclosure, and the message order each have one home |
| Every side effect behind a port, every port with a conformance suite | §5 |
| Every name a glossary term, or proposed | §9 |
| Each phase leaves the tree compiling and green | P1 adds tables and RED tests; P2–P4 add tested building blocks; P5 and P6 turn scenarios green |

# Entitlement Assistant (lab)

A chat assistant for customer service representatives (CSRs) that explains and changes what customers are entitled
to, built on Cloudflare. A lab: a built, deployed experiment, with the specs, decisions, and AI-assisted coding
history that produced it.

**The principle: the model proposes; the policy engine decides.** The language model only calls tools. Every tool
that reads or changes data reaches a use case that asks one decision point (roles, entitlements, and policies written in CEL) before it reads or
changes anything; a change is only prepared, and a person confirms it.

- **Live:** <https://entitlement-assistant.jose-luis-rios.workers.dev> (sign-in only; reviewers receive accounts
  privately)
- **Try it:** [`tech-docs/demo-scenarios.md`](tech-docs/demo-scenarios.md), 21 scripted scenarios: who to sign in
  as, what to type or click, what to expect, and what each shows
- **Code:** [`typescript/system/`](typescript/system/) · **Docs:** [`tech-docs/`](tech-docs/)

## What it does

| Feature | What a CSR can do |
| --- | --- |
| **Employee sign-in** | Sign in; a short-lived signed session cookie; a suspended or unknown employee gets the same answer as a wrong password. |
| **Explain access** | Ask the assistant: what plan an account is on, whether it has a feature, everything it is entitled to, and why a person can or cannot use a feature, with every reason, and a remedy when a plan would include it. A refusal says only what the CSR may know: "not found" to one with no right to read accounts, the policy's reason to one stopped by a policy. |
| **Case lifecycle** | Work in a case: the assistant proposes the account it is about and the CSR sets it; the CSR sets and authenticates the customer contact; events appear as a timeline; the assistant drafts the closing summary. |
| **Grants and approvals** | The assistant prepares temporary feature grants (create, revoke, extend) as a card the CSR confirms; beyond 14 days, a supervisor approves in the approvals panel, and a Cloudflare Workflow waits up to 72 hours, then has the system apply or expire the change. |
| **Usage guards** | One setting caps the assistant's daily AI use; per-employee daily messages; bounded turns; sign-in attempts per IP address; a kill switch. |

Every decision and every change is written to a hash-chained audit trail.

## How it maps to the assignment

| Component | Here |
| --- | --- |
| LLM | Workers AI, `gpt-oss-120b`, through the AI SDK ([CM-19](tech-docs/adr/common.md)) |
| Workflow / coordination | Cloudflare Workflows: one durable process per approval, fed by a transactional outbox; a Cron sweep for grant expiries and redelivery |
| User input | Chat over WebSocket (Agents SDK `AIChatAgent`), a React UI served by the same Worker |
| Memory or state | A Durable Object per case holds the conversation; PostgreSQL (Neon, through Hyperdrive) is the system of record; case events reach the conversation from the audit trail |

## Architecture

```mermaid
flowchart LR
  browser["Browser (React UI)"] -->|HTTPS + WebSocket| worker["Worker: API, static UI"]
  worker --> agent["Durable Object: case agent (one per case)"]
  agent --> ai["Workers AI: gpt-oss-120b"]
  agent -->|tools| app["Use cases → decision point (PDP)"]
  worker --> app
  app --> hyperdrive["Hyperdrive"] --> neon[("PostgreSQL (Neon)")]
  app --> outbox["Transactional outbox"] --> workflow["Workflow: approval process"]
  workflow --> app
  cron["Cron trigger, every 15 min"] --> app
  worker --> limits["Durable Objects: rate limiter, daily allowance"]
```

The code is hexagonal: subsystems (Customer Identity, Internal Identity, Account, Access, Product, Entitlement,
Policy, Authorization, Support, Attribution) each with `model`, `usecase`, and `infra`, meeting only through use cases
and ports; dependency rules are checked on every build.

## Security decisions

| Decision | Where |
| --- | --- |
| Every tool and route that reaches data asks the decision point before it reads; an architecture test runs each as an employee every decision refuses, and fails on anything unlisted | `AI_CONSTITUTION.md` (`llm-never-authorizes`), [grants-and-approvals discovery 35](tech-docs/features/grants-and-approvals/workflow/discoveries.md) |
| Deny by default: nothing is allowed unless a role grants it; policies only add requirements | [AU-3](tech-docs/adr/authorization.md) |
| No existence leaks: a refused read answers as "not found", indistinguishable from an account that does not exist; only a CSR who may read accounts and is stopped by policies alone sees the policy's reasons | [AU-6](tech-docs/adr/authorization.md) |
| The session token says who, never what they may do; permissions are loaded fresh for every decision | [CM-16](tech-docs/adr/common.md) |
| Changes are prepared by the model, confirmed by a person, applied once, re-checked against a stale account; supervisors never approve their own | [SU-4, SU-15](tech-docs/adr/support.md), [grants-and-approvals spec](tech-docs/features/grants-and-approvals/grants-and-approvals.verification-spec.md) |
| A hash-chained audit trail, with no personal data in its records | [Attribution ADRs](tech-docs/adr/attribution.md) |
| Customer data reaching the model is quoted and marked as data; the browser renders text only | [case-lifecycle spec](tech-docs/features/case-lifecycle/case-lifecycle.verification-spec.md) |
| Policies are versioned data (CEL), registered before the Worker that bundles them may decide | [Policy ADRs](tech-docs/adr/policy.md) |
| Passwords hashed with PBKDF2-SHA256 at 100,000 iterations, the cap of Workers' WebCrypto (below current OWASP guidance: a known platform limit) | [`production-readiness.md`](tech-docs/production-readiness.md) |

[`tech-docs/production-readiness.md`](tech-docs/production-readiness.md) lists what a production deployment would
still need.

## How it was built

With Claude Code, one feature at a time: a verification spec approved first, an architect plan, tests written to
fail first, then the build, mutation checks of the security rules, and adversarial reviews by a separate agent until
nothing serious remained. Each feature's judgment calls are logged for review in its `workflow/discoveries.md`.

| Where | What |
| --- | --- |
| [`tech-docs/entitlement-assistant-proposal.md`](tech-docs/entitlement-assistant-proposal.md) | The proposal, glossary, and scenarios |
| [`tech-docs/features/`](tech-docs/features/) | One verification spec per feature, with its plan, progress, and discoveries |
| [`tech-docs/adr/`](tech-docs/adr/), [`tech-docs/data-model/`](tech-docs/data-model/), [`tech-docs/api/api.md`](tech-docs/api/api.md), [`tech-docs/diagrams/`](tech-docs/diagrams/) | Decisions, data model, API, diagrams |
| [`tech-docs/data-model/schema.sql`](tech-docs/data-model/schema.sql) | The database schema as built, every table in one place: for viewing only, generated by `npm run db:schema`. The migrations (`typescript/system/**/migrations/`) are the source. |
| `AI_CONSTITUTION.md`, `AI_WORKFLOW.md`, `AI_AS_*.md` | How the owner and the assistant worked: rules, roles, quality bar |
| [`PROMPTS.md`](PROMPTS.md), [`tech-docs/prompt-history/`](tech-docs/prompt-history/) | The AI-assisted coding history, redacted: every prompt, reply, and tool call |

**Tests:** about 660 (unit, use case against PostgreSQL, HTTP, the Workers runtime with a scripted model and real
Workflows), with live evaluations of the real model recorded in each feature's discoveries.

## Run it locally

Needs Node 24, Docker, and a Cloudflare account (`npx wrangler login`): Workers AI runs remotely even in local
development, and uses the account's allowance.

```bash
cd typescript/system
npm install
npm run db:up                                   # PostgreSQL 17 in Docker, port 54329
export DATABASE_URL=postgres://postgres:local-development-only@localhost:54329/entitlement_assistant
npm run db:migrate && npm run db:seed           # the fixtures, with demo passwords (alex-demo-password, …)
npm run policies:register                        # the bundled policy set becomes active
npm run secrets:local                            # writes .dev.vars (session, audit, and identifier keys)
npm run dev                                      # builds the UI, then wrangler dev
```

Sign in as `alex@provider.example` / `alex-demo-password` (a representative) or `morgan@provider.example` /
`morgan-demo-password` (a supervisor). `npm run check` runs Biome, the type checks, the dependency rules, and every
test (the tests create their own databases in the same PostgreSQL).

## Deploy

Neon and a Hyperdrive configuration, then: migrate, seed with generated passwords, register the policy set, put the
secrets, and `npx wrangler deploy` (Durable Objects, the Workflow, and the Cron trigger are in `wrangler.jsonc`). The
demo routine (reset, accounts, usage caps, the kill switch) is in
[`tech-docs/demo-runbook.md`](tech-docs/demo-runbook.md).

## Not built

- **Change subscription** (plan changes, cancellations, account history): specified in the proposal, not built.
- **Candidates:** courtesy terms, role changes, "what am I allowed to do?", an MCP server, voice input.
- Known limits of this lab, and what production would add, are in
  [`tech-docs/production-readiness.md`](tech-docs/production-readiness.md).

## Licence

[MIT](LICENSE).

# As a Software Architect

Read with `AI_CONSTITUTION.md`. The architect plans; the owner decides. The architect may not choose
on the owner's behalf, but must always advise.

## 1. Architecture: subsystems as modules, each hexagonal inside

```text
entitlement-assistant/
  tech-docs/
  typescript/
    system/
      kernel/                    shared pure types and functions: Result, branded ids, the id codec (CM-14)
      port/                      shared ports: Clock, IdGenerator, UnitOfWork, AuthorizationDecider, …
      adapter/                   shared adapters: wrap external libraries, or our own implementations, to satisfy ports
      external/                  third-party libraries
      subsystem/
        customer-identity/  internal-identity/  account/  access/  product/
        entitlement/  support/  attribution/  policy/  authorization/
          src/
            model/               pure rules: entities, value objects, calculations; no I/O
            usecase/             use cases, and the ports this subsystem needs
            infra/               this subsystem's adapters (its PostgreSQL repositories, its migrations)
          tests/                 unit and functional
      application/
        entitlement-assistant/
          src/                   bootstrap (the composition root), Worker entry, case agent, tools, HTTP endpoints, UI
          resource/              non-code assets: policies/, seed/
          tests/                 end-to-end, and the feature verification tests
```

**Dependency rules** (rules `dependencies-point-inward` and `subsystems-meet-through-use-cases`):

| Part | May import | Must not contain |
| --- | --- | --- |
| `model` | its own `model/` and the shared `kernel/` | I/O, `fetch`, Cloudflare APIs, SQL, time (`Date.now()`), randomness |
| `usecase` | its `model/`, shared `port/`, other subsystems' public use cases and ports | adapters, framework types, SQL |
| `infra` | its `usecase/` and `model/`, shared `adapter/`, `external/` | business rules |
| shared `kernel/` | nothing outside itself | I/O of any kind |
| shared `adapter/` | shared `port/`, `kernel/`, `external/` | business rules |
| `application` (bootstrap) | everything | logic beyond wiring and inbound translation |

- **Subsystems meet only through public use cases and ports**: never another subsystem's model internals,
  and never its tables. Each subsystem owns its tables and migrations.
- **Only adapters and `infra` know third-party libraries** (`external/`); nothing below them does.
- **`authorization`** has no tables: it hosts the PDP (the pipeline of handlers over Account, Access,
  Entitlement, and Policy) and the PIP. Each use case is a PEP, through one shared template: authorize,
  execute, audit (AU-5).
- **Layer order** (CM-15), from the bottom up: customer identity and internal identity → account → product →
  access → entitlement → policy → authorization → support; attribution is a sink with soft references only.
  Foreign keys and dependencies point down; upward links are soft references, and cascades upward run
  through use cases.
- **Shared ports** (CM-17): every subsystem reaches authorization through `AuthorizationDecider` and
  attribution through `AuditRecorder`, both in shared `port/`; no subsystem imports Authorization's or
  Attribution's use cases directly.
- **Ownership of cross-cutting pieces:** sign-in lives in Account (it binds an authenticated identity to an
  account); the typed decision context per action is Authorization's contract; the action registry is
  Access's; the account version bump is Account's.
- **Disclosure** (AU-6): a PEP maps a refusal to `Denied` only for an authenticated principal who may read
  the subject and is stopped by a policy; otherwise to `NotFound`. Unauthenticated requests stop at `401`
  before any use case runs.
- **Transactions** span subsystems through a `UnitOfWork` port that each participating use case joins (for
  example, applying a change: Support, Entitlement, Account, Attribution).

## 2. Principles

1. **Every side effect is a port.** Time (`Clock`), randomness (`IdGenerator`), persistence, the
   language model (the AI SDK's model interface, CM-18), token signing, and workflow scheduling are ports. This is what makes the domain
   testable and the verification tests deterministic.
2. **Ports are named for the role they play, not the technology.** `CustomerAccountRepository`,
   `LanguageModel`, `SessionTokenVerifier`. No `Adapter`, `Manager`, or `Helper` suffixes.
3. **Adapters are named for the technology and the port.** `PostgresCustomerAccountRepository`,
   `WorkersAiLanguageModel`, `JoseSessionTokenVerifier`.
4. **Each port has a conformance suite** that every adapter (including test doubles) passes. That is
   what plug and play means here.
5. **One algorithm, one building block.** Effective entitlements are computed in exactly one place;
   policy decisions are made in exactly one place. A second implementation is a defect.
6. **Use cases are the only entrance to behavior.** HTTP endpoints, chat tools, and (later) an MCP server
   are inbound adapters that translate a request into a use case call. They hold no rules.
7. **The use case is the Policy Enforcement Point.** It asks the PDP before every read and change, with
   the principal it was given by the inbound adapter, which took it from the verified session.
8. **Errors are values.** Domain and application return `Result<Success, Failure>` with discriminated
   failure types. Exceptions are for programming errors and infrastructure faults only.
9. **Name the style.** A plan states the architectural style or pattern each change applies and why.
   A style is chosen because the problem has its shape, never by habit.

## 3. The feature plan

An architect plan (`tech-docs/features/<feature>/workflow/architect-plan.md`) contains:

1. The phases, in an order where each phase compiles and leaves tests green except for the
   scenarios still owed.
2. For each phase: the ports, use cases, adapters, and schema changes, with the scenarios it turns green.
3. Every new term, proposed to the owner before use.
4. The building block for each algorithm added or changed.
5. Open questions for the owner, each with a recommendation.

## 4. Review checklist (architect reviewer)

- Does every scenario of the spec land in a phase?
- Does any arrow point outward? Does any rule live in an adapter?
- Is any algorithm computed in two places?
- Is every side effect behind a port, and does every port have a conformance suite?
- Is every name a glossary term, or proposed as one?
- Does each phase leave the tree compiling and green?

# As a Software Developer

Read with `AI_CONSTITUTION.md` and `AI_AS_ARCHITECT.md`. The developer implements one phase of an
accepted plan.

## 1. Stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` |
| Runtime | Cloudflare Workers (`nodejs_compat`), Wrangler |
| Agent | Agents SDK `AIChatAgent`, one instance per case |
| LLM | Workers AI, Llama 3.3 70B Instruct, through the AI SDK |
| Database | PostgreSQL through Hyperdrive; `pg` driver; SQL migrations in each subsystem's `src/infra/` |
| Session token | `jose` (JWT signing and verification) — no hand-written cryptography |
| Validation | `zod` for tool arguments and HTTP bodies, strict (unknown keys rejected) |
| UI | React + Vite, served as Worker static assets; `agents/react` chat hooks |
| Tests | Vitest; `@cloudflare/vitest-pool-workers` for Worker and agent tests; local Docker PostgreSQL |
| Format and lint | Biome |
| Layering | dependency-cruiser |

## 2. Rules

1. **Implement the plan, not more.** Something the plan lacks is reported, not added.
2. **Contracts on every public function and port method:**

   ```ts
   /**
    * Computes the effective entitlements of a customer account at an instant.
    *
    * @requires `subscription.accountId` equals `account.accountId`.
    * @ensures Every returned entitlement names at least one entitlement source.
    * @ensures A suspended account has no effective entitlement.
    */
   ```

3. **Types carry meaning.** Branded identifiers (`AccountId`, `CsrId`, `FeatureKey`), discriminated
   unions for states and outcomes, `readonly` data, exhaustive `switch` ending in an `assertNever`.
   No `any`, no non-null assertions, no type casts outside adapters' parsing boundaries.
4. **Names.** Glossary terms, long and clear. Files `kebab-case.ts`; types `PascalCase`; functions and
   variables `camelCase`. No abbreviations (`account`, not `acct`), except in the account id format.
5. **No ambient side effects** in `model/` or `usecase/`: no `Date.now()`, `crypto.randomUUID()`,
   `console`, `fetch`, or environment access. Use the ports.
6. **Secrets** come from Worker secrets and `.dev.vars` (never committed). No secret is logged.
7. **SQL** is parameterized, always. Every query lives in an outbound adapter.
8. **Unit tests** accompany the code: one test per contract clause (`ensures …`, `requires …`), named
   after the clause.
9. **Database guarantees are named, not re-checked** (CM-13). Where code relies on a constraint
   instead of checking, its contract says so and names the constraint:

   ```ts
   /**
    * Assigns a case to an internal account.
    *
    * @requires `assigneeAccountId` belongs to an internal account.
    * @relies-on db: case_assignment_assignee_fk (references internal_account)
    * @relies-on db: case_assignment_one_active_per_case (partial unique index)
    */
   ```

10. **Security rules for the chat surface:**
    - The case agent's state is never writable by the client: reject client state updates, and expose no
      callable that changes state. The principal, case, and subject never live in client state.
    - The server closes a WebSocket when its session token expires; the assignment is re-checked per message.
    - The UI renders customer text and model output escaped, under a strict Content Security Policy, with no
      remote images and no auto-loaded links (a common exfiltration path for injected prompts).
    - Confirmations are client actions the model cannot trigger, and render the stored diff (SU-9).
    - Decision reads bypass Hyperdrive's query cache.
    - Sign-in verifies a dummy PHC hash for unknown emails, so timing reveals nothing.

11. **Durable comments only:** a comment says why the code is the way it is, never when or for which task.

## 3. Commands (from `typescript/system/`)

```sh
npx biome check --write .          # format and lint, first
npx tsc --noEmit                   # types
npx vitest run <path-or-filter>    # scoped tests while working
npx wrangler dev                   # run locally
```

The full suite runs once, at the GREEN gate (`AI_WORKFLOW.md` §3).

## 4. Code review checklist (code reviewer)

- Every identifier a glossary term; no vague names (`data`, `info`, `manager`, `handle`).
- Every public function has contracts, and a test per contract clause.
- No rule in an adapter; no I/O in domain or application.
- No duplicated algorithm.
- Failures as `Result`; every union matched exhaustively.
- No temporal or task references in code, comments, or test names.

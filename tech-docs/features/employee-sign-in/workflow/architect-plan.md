# Employee Sign-In — Architect Plan

| | |
| :--- | :--- |
| **Purpose** | How employee-sign-in is built: phases, ports, adapters, schema, and the scenarios each phase turns green. |
| **Status** | Self-reviewed (demo mode, `AI_WORKFLOW.md` §2); owner accepted the phase outline 2026-10-25 |
| **Feature** | employee-sign-in · S01–S03, S04a–S04f |
| **References** | • Spec: [`../employee-sign-in.verification-spec.md`](../employee-sign-in.verification-spec.md)<br>• API: [`../../../api/api.md`](../../../api/api.md) §3, §4<br>• Structure: [`../../../../AI_AS_ARCHITECT.md`](../../../../AI_AS_ARCHITECT.md)<br>• Data model: Internal Identity, Account, Access, Attribution in [`../../../data-model/`](../../../data-model/README.md) |

## 1. Phases

| # | Phase | Delivers | Scenarios green |
| --- | --- | --- | --- |
| P0 | Scaffolding | `typescript/system/` as one npm package with the documented folders; TypeScript (strict), Biome, dependency-cruiser rules for the three structural rules of the register, Vitest; Docker PostgreSQL; a migration runner applying each subsystem's migrations in layer order; `wrangler.toml` with Hyperdrive and static assets | — |
| P1 | Shared building blocks | `Result`, branded ids, the prefixed id codec (CM-14); ports `Clock`, `IdGenerator`, `UnitOfWork`, `SecurityEventLog`; adapters: system and fixed clocks, UUIDv7 generator, PostgreSQL unit of work, console and recording security event logs; conformance suites | — |
| P2 | Schema and seed | Migrations: Internal Identity (all tables), Account (`account`, `internal_account`, `account_hold`), Access (resource operations, permissions, roles, role permissions, birthright, internal role and permission assignments), Attribution (all tables); the employee seed from YAML with deterministic ids per alias; a schema test that foreign keys point downward | — |
| P3 | Attribution | `AuditRecorder` port (shared) and its PostgreSQL adapter: head lock, RFC 8785 canonical JSON, HMAC-SHA-256 chain, inside the caller's unit of work, fail closed; `VerifyChain` | — |
| P4 | Sign-in | Internal Identity: `VerifyEmployeeCredential` (PBKDF2 through WebCrypto, PHC strings, dummy hash for unknown emails). Account: `SignIn` (the account binding, holds, audit), `SessionTokenIssuer` port with a `jose` adapter. HTTP: the application's router, the sign-in endpoint, origin check, strict body parsing, error bodies (api.md §3), security headers | S02; S01 up to the token |
| P5 | Session | `SessionTokenVerifier` port and adapter; Account: `LoadPrincipal` (fresh: identity status, holds, job attributes, roles from birthright and internal assignments), `GetPrincipal`, `RenewSession` (pure renewal rule in the model), `SignOut`; the authenticated-request pipeline | S01, S03, S04a–S04f |
| P6 | Minimal UI | React sign-in page and a signed-in page, served as static assets; calls the authentication endpoints | — |

## 2. Building blocks and styles

| Concern | Building block | Style and why |
| --- | --- | --- |
| Inbound HTTP | `application/…/src/http/router.ts`, one handler per endpoint | Adapter: translates a request into one use case call and a result into a response; no rule |
| Composition | `createApplication(dependencies)` returns a `fetch` handler; the Worker entry builds dependencies from `env`, tests build them with a fixed clock and test keys | Composition root; lets verification tests drive the real handler in Node |
| Renewal rule | `account/src/model/session-renewal.ts`: `decideRenewal(token, now, principalValid)` → `NoChange` · `Renew(exp)` · `RefuseAtCap` · `RefusePrincipal` | Pure function; one place for the rule |
| Principal | `account/src/usecase/load-principal.ts`, used by every authenticated request and by renewal | One loader (CM-16); never reads token claims beyond `sub` |
| Audit | `port/audit-recorder.ts`; `attribution/src/infra/postgres-audit-recorder.ts` | Shared port (CM-17); attribution depends on no table (CM-15) |
| Password check | `internal-identity/src/usecase/verify-employee-credential.ts` + `PasswordHasher` port; WebCrypto adapter | Same work for known and unknown emails |

## 3. Schema notes

- Each subsystem owns `src/infra/migrations/NNN-name.sql`; the runner applies subsystems in layer order:
  internal-identity, account, access, attribution.
- Display names live in `account.account_display_name`; `employee` keeps `given_name` and `family_name`.
- `permission.feature_key` and `account_role_assignment` arrive with the Product and Customer Identity
  tables (feature explain-access); this feature creates the employee and system side only.
- The application's database role gets `INSERT, SELECT` only on audit tables (CM-13); the migration runner
  uses an owner role.

## 4. Test approach

- Verification tests (`[http]`) run in Node with Vitest, calling the handler from `createApplication` with
  `Request` objects, against Docker PostgreSQL. Each test starts from a fresh database cloned from a
  migrated and seeded template (`CREATE DATABASE … TEMPLATE …`), so tests are independent.
- Tokens for S03 and S04 are minted by a test helper with the server's test key (or a foreign key).
- One end-to-end smoke test runs against `wrangler dev` (Workers runtime, Hyperdrive local connection).

## 5. Platform constraints found

| Constraint | Effect |
| --- | --- |
| Workers WebCrypto caps PBKDF2 at 100,000 iterations | PHC strings use `i=100000`; Argon2id is a production-readiness item |
| TypeScript 7 (native) is new | TypeScript 6.0 is used, for tool compatibility (dependency-cruiser, Vitest) |

## 6. Spec correction (before RED)

S04c renewed a token that already ended at the absolute lifetime, contradicting D2 and S04d. S04c now
starts from a normal token (`iat` 15:20, `exp` 15:50, instant 15:40) and shows capping (`exp` 16:00,
`Max-Age` 1200); S04d and S04e use that capped token (`iat` 15:40, `exp` 16:00). Reported to the owner.

## 7. Self-review

| Check | Result |
| --- | --- |
| Every scenario lands in a phase | S01–S03, S04a–f in P4 and P5 |
| Any arrow pointing outward, any rule in an adapter | none planned; guarded by dependency-cruiser from P0 |
| Any algorithm in two places | renewal rule and principal loading each have one home |

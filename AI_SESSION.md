# AI Session — current state

**Updated:** 2026-10-26 (explain-access P8)

## State

- **Design complete:** proposal (`tech-docs/entitlement-assistant-proposal.md`, rulings in §9), data model per
  subsystem (`tech-docs/data-model/`), ADRs (`tech-docs/adr/`), API (`tech-docs/api/api.md`), production
  readiness, diagrams.
- **Feature employee-sign-in: done.** Spec approved (amended for the rename); built in demo mode; adversarial
  review accepted in round 2; GREEN 91 passed @ 76474ed; merged to `main`. Records in
  `tech-docs/features/employee-sign-in/workflow/`.
- **Product renamed** Entitlement Assistant (`entitlement-assistant/`), merged to `main` @ 6ca41db (GREEN 91
  passed @ 9d8d2e7).
- **Deployed** (2026-10-25) at `https://entitlement-assistant.jose-luis-rios.workers.dev` from `main`
  (branch `feature/deploy`: generated seed passwords, HTTPS redirect). Neon migrated and seeded with generated passwords (`typescript/system/.env.seed-passwords`); login role
  `entitlement_assistant_worker` (URL in `.env.neon`); Hyperdrive `84702090e1e048eeb5970a7b2ab19fa0`, caching
  disabled; production secrets in `.env.production-secrets.json`. All three files are git-ignored, mode 600, and never
  shown in chat. Smoke test passed: sign-in, session, identical refusals (demo password, unknown email, suspended),
  foreign origin 403, `__Host-` cookie with HttpOnly, Secure, SameSite=Strict, CSP and HSTS headers.
- **Feature explain-access: P1–P8 built** on branch `feature/explain-access` (last commit cbe8bc6), deployed
  (version `b39c53a8`). Neon reset, migrated, and reseeded (same generated passwords, fixture day 2026-10-26); the
  bundled policy set registered and activated as `sys_deployment` (`npm run policies:register`). Live smoke test
  passed (redirect, sign-in, case, foreign-origin upgrade 403, check and refusal turns, another CSR's case 404).
  Spec §5 evaluation, 4 messages × 5 runs: tool choice 20/20; answers in words 13/20, then 20/20 after the fix
  (discoveries 33, 34). State in `tech-docs/features/explain-access/workflow/progress.md`.

## Next session

1. Owner: keep the production secrets in a password manager.
2. Explain-access spike K5 (resume here): other Workers AI models with function calling against the same §5
   evaluation, tool choice and answers in words, time-boxed to about two hours; first confirm the candidates in the
   current Workers AI catalog. A switch needs the owner's ruling, a spec amendment (it names Llama 3.3 70B), and an
   ADR.
3. Then the GREEN gate on a clean tree, the adversarial review, and the merge into `main` with the owner's approval.

## Decisions (owner, 2026-10-22)

- The human is the CSR; the AI is the assistant.
- CSR authentication: application sign-in of pre-seeded employees, stateless JWT in an HttpOnly cookie.
- Policy engine: a small typed evaluator of the project's own, behind a PDP port.
- System of record: PostgreSQL through Hyperdrive.
- Work in features; hexagonal and clean architecture; slimmed-down constitution.

## Decisions (owner, 2026-10-25)

- Security over speed: all recommendations accepted to time-box the demo, never at security's cost; refusals
  reveal information only to a proven legitimate principal (AU-6).
- CM-5 accepted (every effect on a customer traces back to a person's click).
- Tool calling in the demo; MCP in production. Channels (browser, chat, tools, MCP) as namespaces with their own
  constraints: production-readiness.
- API: authentication and case domains; OAuth 2 errors, details only when the caller may see them; snake_case.
- Specs: front matter; every scenario listed in the contents; cases one by one (Case A, B, …) or split scenarios
  (S04a, …); raw HTTP; JSON formatted, `Content-Length` of the compact form.
- Demo mode: self-reviews, one adversarial review per feature; gates unchanged.
- Specs are written just before a feature is built.
- Commits: the owner approved committing and merging employee-sign-in and the rename.
- Product name: Entitlement Assistant. Neon for PostgreSQL. Wrangler with minimum OAuth scopes:
  `account:read user:read workers:write workers_scripts:write workers_tail:read`.
- Prompt history and the GitHub remote come at the end; transcripts published redacted under `tech-docs/`.
- A database that is not local is seeded with generated, easy-to-type passwords (`alex-k7m2-x9qp-4hdr`), never the
  published demo passwords (option A). `neonctl` installed globally.
- Explain-access spec rulings: D9 WebSocket upgrades need the application's Origin; D10 every message re-loads the
  principal (close 4401 invalid_session); D11 messages over 16 KiB close with 1009; D12 a principal without
  account.read is refused before any customer data is read, and a lookup matching nothing is audited
  (support.no-matching-account, query HMAC only); D13 20 messages per minute per employee, a Durable Object counter
  behind a rate-limiter port, close 4429 rate_limited; security-event causes CaseNotFound and CaseNotAssigned.
- Explain-access plan approved with every recommendation: agent tests fall back to a plain class in Node if the
  Workers pool spike fails; policy registration and activation in this feature; spec cases are test fixtures, not
  seed; the deployed seed shifts fixture dates to the seeding day; one feature. Terms approved: message rate limiter,
  connection session, permission gate, policy expression evaluator, scripted language model.
- RED gate kept with mutations owed for S05c and S08e case C (both proven in P5); S05j and S09a amended; failing
  tests not yet built are skipped and committed, then enabled in the phase that builds them.
- The case agent is a hardened `AIChatAgent` (CM-18): the Agents SDK is expected for a Cloudflare application; spike
  K4 proved a WebSocket message guard in front of the SDK closes the client-history risk. The alternative without the
  SDK is documented in `tech-docs/design/case-agent-without-agents-sdk.md`. Terms ruled: inbound guard, HTTP request
  guard, WebSocket message guard, WebSocket message, WebSocket frame; case conversation store names the SDK's storage.
- Plain HTTP is redirected (308) to the configured HTTPS origin by the Worker, which runs first for every request;
  owner tried the live deployment and approved merging `feature/deploy`.

## Decisions (owner, 2026-10-26)

- Replies show Tools, Answer (formerly Result), and Details built only from tool results (option B); full account
  ids; a check that finds a feature missing carries its remedy; Cmd+Enter (Ctrl+Enter) sends.
- Deployments are recorded as the system identity `sys_deployment`, authenticated only by the owner's database
  credentials in the demo; production would use CI workload identity (production-readiness).
- Neon reset and reseeded for explain-access with the same passwords (1A).
- Answer wording fixed (look accounts up first, no tool call as text, "No answer was written; see Details."
  fallback); spike K5 to compare other Workers AI models.

## Open

- Feature-spec decisions are approved with each spec.

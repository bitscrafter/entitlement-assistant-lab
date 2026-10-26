# AI Session — current state

**Updated:** 2026-10-25 (deploy session)

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
- **Feature explain-access:** spec updated and approved (2026-10-25) on branch `feature/explain-access`, with the
  agent connection sequence (`tech-docs/diagrams/agent-connection.sequence.puml`). Next: the architect plan.

## Next session

1. Owner: keep the production secrets in a password manager.
2. Explain-access architect plan (ports, adapters, schema, seed data, automated end-to-end test), owner review, then
   RED tests and build (demo mode).

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
- Plain HTTP is redirected (308) to the configured HTTPS origin by the Worker, which runs first for every request;
  owner tried the live deployment and approved merging `feature/deploy`.

## Open

- Feature-spec decisions are approved with each spec.
- `AI_WORKFLOW.md` §3 runs `depcruise src`, but the package has no `src` at its root, so that step checks nothing;
  `depcruise .` (as in `npm run check`) is the working command. Not yet fixed.

# AI Session — current state

**Updated:** 2026-10-25 (end of session)

## State

- **Design complete:** proposal (`tech-docs/entitlement-assistant-proposal.md`, rulings in §9), data model per
  subsystem (`tech-docs/data-model/`), ADRs (`tech-docs/adr/`), API (`tech-docs/api/api.md`), production
  readiness, diagrams.
- **Feature employee-sign-in: done.** Spec approved (amended for the rename); built in demo mode; adversarial
  review accepted in round 2; GREEN 91 passed @ 76474ed; merged to `main`. Records in
  `tech-docs/features/employee-sign-in/workflow/`.
- **Product renamed** Entitlement Assistant (`entitlement-assistant/`), merged to `main` @ 6ca41db (GREEN 91
  passed @ 9d8d2e7).
- **Not deployed yet.** The owner is doing `wrangler login` (minimum scopes below) and has a Neon project with
  database `entitlement_assistant`; its owner connection string is in `typescript/system/.env.neon`
  (git-ignored; never shown in chat, because transcripts are published).
- **Feature explain-access:** its spec exists but predates what employee-sign-in established; it is updated
  just before it is built (owner rule: specs just in time).

## Next session

1. Owner renames the parent folder `clooudflare` → `cloudflare` between sessions and copies the memory folder to
   the new Claude Code project path (steps in the last message of this session); the next session starts from
   `cloudflare/`. The export script takes both transcript folders (`--transcripts-dir` twice).
2. Deploy (README, Deploy): check `npx wrangler whoami` and `npx wrangler hyperdrive list` (a permission error
   means one more scope); migrate and seed Neon from `.env.neon`; create the login role
   `entitlement_assistant_worker` IN ROLE `entitlement_assistant_app` with a generated password stored in
   `.env.neon`; `wrangler hyperdrive create … --caching-disabled`; put its id in `wrangler.jsonc`; set secrets with
   fresh production keys; build the UI; deploy; check HTTPS on `workers.dev`; smoke-test the live URL.
3. Update the explain-access spec, owner approval, build.

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

## Open

- Feature-spec decisions are approved with each spec.
- Whether `workers:write` covers Hyperdrive (checked at deploy).

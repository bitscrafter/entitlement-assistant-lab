# AI TODO

## To Do

1. Owner: rename the parent folder `clooudflare` → `cloudflare` between sessions; copy the memory folder to the new project path.
2. Deploy (owner: `wrangler login` with minimum scopes; Neon project `entitlement_assistant`, connection in `.env.neon`): migrate and seed Neon, login role, Hyperdrive with caching disabled, secrets, deploy, smoke test (README, Deploy; AI_SESSION, Next session).
3. At the end: export the prompt history, redacted, into a folder under `tech-docs/` (owner, 2026-10-25); raw transcripts stay git-ignored.
4. At the end: GitHub remote (owner, 2026-10-25).
5. Feature explain-access: update its spec to what employee-sign-in established, owner approval, then build (demo mode).

## Completed

- Proposal: purpose, glossary, domain model, cross-cutting models, scenarios in features; rulings recorded.
- Slim constitution written.
- First verification spec drafted (later split into employee-sign-in and explain-access).
- Sign-in sequence diagram and data model ER diagram (PlantUML).
- Git repository initialized; prompt-history export script (reads several transcript folders).
- Customer Identity data model ruled and documented (`tech-docs/data-model/customer-identity.md`).
- ADRs introduced (`tech-docs/adr/`), table-based format.
- Internal Identity data model ruled and documented (employees, system identities, credentials); emails stored normalized only (CM-10).
- Access data model ruled and documented (AC-1…8; subsystem renamed from Authorization, which names the decision)
- Product data model ruled and documented (PR-1…7); kebab-case keys (CM-12).
- Entitlement data model ruled and documented (EN-1…8): access periods control the whole subscription; `is_paid` removed (PR-8 supersedes PR-5).
- Support data model ruled and documented (SU-1…7): case assignments, subject and caller, change requests with RFC 6902 diffs, approvals with a durable timer.
- Account subsystem ruled and documented (AN-1…5): shared account table, internal accounts, immutable category, holds on every account, session acts as one declared account; SU-8 caller authority; CM-13.
- Attribution data model ruled and documented (AT-1…7): audit records with participants and reasons, HMAC chain; CM-14 UUIDv7 ids; caller renamed contact.
- Policy (PO-1…6) and Authorization (AU-1…3) ruled; AT-5 Conditional; CM-14 covers hashes; project structure adopted (CM-1 amended; architect and tester guides updated).
- Status vs timestamps rule (CM-11).
- Proposal and Slice 1 spec aligned with the data model (2026-10-24).
- Thorough review (three reviewers) applied (2026-10-25): subscription terms (EN-9, EN-10, PR-9), layer order and soft references (CM-15), identity-only session token (CM-16), contact authentication (SU-10), lifecycle use cases (SU-9), approval re-check and inbox (SU-11, SU-12), stale requests (SU-13), account.read gate (AU-4), PDP/PIP placement (AU-5), remedies (PR-10), reason-code register, prerequisites, plus wording and consistency fixes.
- Second review applied (2026-10-25, D1–D26 and section B): disclosure rule (AU-6), assignee rule (SU-14), apply re-check against the confirmer's decision (SU-15, supersedes SU-11), shared ports (CM-17); new policies (trial and courtesy coverage, cancellation approval, grant quota), canonical audit records with soft account references, action registry and `case.reassign`, sign-in in Account, id-prefix register; diagrams, data models, production readiness, proposal, both feature specs, and the tester and architect guides updated.
- CM-5 accepted (2026-10-25). API document drafted: endpoints, agent frames, tools, use cases by subsystem, one error model with AU-6 disclosure.
- Feature employee-sign-in (2026-10-25): S01–S03, S04a–S04f green; adversarial review accepted in round 2; GREEN 91 passed @ 76474ed; merged to main.
- Renamed to Entitlement Assistant (2026-10-25): merged @ 6ca41db; GREEN 91 passed @ 9d8d2e7.

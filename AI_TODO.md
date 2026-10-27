# AI TODO

## To Do

1. At the end: export the prompt history, redacted, into a folder under `tech-docs/` (owner, 2026-10-25); raw transcripts stay git-ignored.
2. At the end: GitHub remote (owner, 2026-10-25).
3. Next (owner, 2026-10-27): rather than a new feature, make what exists deployable and demoable, so the owner can demo the app and submit the Cloudflare job application.
4. Later (owner, 2026-10-27): documentation of the solution's viewpoints with videos and a live player: ER diagram, sequence and state diagrams, security decisions, principles.

## Completed

- Live checks complete (2026-10-27, Workers Paid): explain-access §5 25/25 turns (discovery 40), case-lifecycle live check passed (discovery 16).

- Usage guards (2026-10-27): daily AI budget from one setting, per-employee daily messages, bounded turns, sign-in per IP, kill switch, `npm run demo:reset`, reviewer accounts `cf-` and `bc-`; merged to `main` and deployed.

- Grants-and-approvals live check passed against the deployment (discovery 34) and merged to `main` (`7c8914c`, 2026-10-27); deployed from `main` (`c05d86ca`), GREEN 607, smoke test passed.

- Grants-and-approvals built, reviewed twice, committed on `feature/grants-and-approvals` (`0ef4f28`), deployed (`ff293743`, 2026-10-27) after a Neon reset and reseed with Morgan; GREEN 606.

- Explain-access and case-lifecycle merged into `main` (2026-10-27): 7d64a27, 16d63fc; GREEN 537 on `main`; deployed from `main` (`0c06f4f0`); smoke test passed.

- Case-lifecycle built (2026-10-26): 28 + 9 scenarios across three owner-approved amendments, six review rounds, GREEN 537 @ c164cc2, deployed `418de419`.

- Explain-access P1–P8 (2026-10-26): plan approved, spikes K1–K4, hardened `AIChatAgent`, deployed (`b39c53a8`), live smoke test passed, §5 evaluation 20/20 tool choice and 20/20 answers in words after the fix; last commit cbe8bc6.

- Explain-access spec updated and approved (2026-10-25): D9–D13, S05k–S05m, agent connection sequence diagram.

- Deployed (2026-10-25) to `entitlement-assistant.jose-luis-rios.workers.dev`: generated seed passwords (GREEN 104 passed @ 55c77ce), Neon migrated and seeded, worker login role, Hyperdrive with caching disabled, secrets, smoke test passed; plain HTTP redirected to HTTPS by the Worker; `feature/deploy` merged @ c8a9886.
- `AI_WORKFLOW.md` GREEN gate runs `depcruise .` (the package has no root `src`).
- Parent folder renamed to `cloudflare`; `wrangler login` with the minimum scopes (`workers:write` covers Hyperdrive).

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

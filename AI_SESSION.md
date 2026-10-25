# AI Session — current state

**Updated:** 2026-10-25

## State

- Proposal drafted and ruled: `tech-docs/entitlement-agent-proposal.md` (§9 records the product rulings).
- Constitution written: `CLAUDE.md`, `AI_CONSTITUTION.md`, `AI_WORKFLOW.md`, `AI_AS_*.md`.
- Feature specs drafted, awaiting owner approval: `tech-docs/features/employee-sign-in/` and
  `tech-docs/features/explain-access/`.
- Data model designed per subsystem under `tech-docs/data-model/`; Customer Identity, Internal Identity, Access, Product, Entitlement, Support, Account, Attribution, Policy, Authorization ruled: data model complete. Proposal and first feature specs aligned; two reviews applied 2026-10-25 (the second as D1–D26). API ruled (`tech-docs/api/api.md`). Next: case-lifecycle and change-subscription specs. Decisions in `tech-docs/adr/`.
- Design order (owner): data model per subsystem → policy model → APIs → scenarios (sign-in first).
- No code yet (owner: not ready to code). Git initialized, no commits.

## Decisions (owner, 2026-10-22)

- The human is the CSR; the AI is the assistant.
- CSR authentication: application sign-in of pre-seeded CSRs, stateless JWT in an HttpOnly cookie.
- Policy engine: a small typed evaluator of the project's own, behind a PDP port.
- System of record: PostgreSQL through Hyperdrive.
- Work in features (renamed from slices 2026-10-25); employee-sign-in and explain-access first.
- Hexagonal and clean architecture; slimmed-down constitution.

## Decisions (owner, 2026-10-25)

- Tool calling in the demo; MCP in production.
- Prompt history and the GitHub remote are done at the end.
- API: authentication and case domains, OAuth 2 errors (details only when the caller may see them), snake_case on the wire; adapters as namespaces documented for production.
- Spec cases are written one by one (Case A, B, …), each with its full request and response.

- Reviews kept light to finish the demo: no per-phase or plan reviews by agents; one adversarial review of each feature before merge; gates (lint, types, layering, tests) unchanged.

## Open

- Feature-spec decisions are approved with each spec.
- Security rule from the owner (2026-10-25): refusals reveal information only to a proven legitimate principal (AU-6).

# Entitlement Assistant — AI collaboration entry point

A chat assistant for Customer Service Representatives (CSRs) that explains and changes customer
entitlements, built on Cloudflare (Workers, Agents SDK, Workflows, Workers AI) with PostgreSQL.

- `tech-docs/` — the proposal, glossary, feature verification specs, and work records
- `typescript/system/` — the code: shared ports and adapters, subsystems, and the application
- `prompt-history/` — the AI-assisted coding transcripts submitted with the project

## Session start protocol

1. Read [`AI_CONSTITUTION.md`](AI_CONSTITUTION.md) — how the owner and the assistant work, the quality
   bar, what counts as evidence, and the rule register.
2. Read [`AI_SESSION.md`](AI_SESSION.md) and [`AI_TODO.md`](AI_TODO.md) — where the work stands.
3. Read the role document for the message prefix (no prefix → developer):

| Prefix | Role | Read |
| --- | --- | --- |
| `arch:` | Software architect | [`AI_AS_ARCHITECT.md`](AI_AS_ARCHITECT.md) |
| `dev:` | Software developer | [`AI_AS_DEVELOPER.md`](AI_AS_DEVELOPER.md) |
| `test:` | Software tester | [`AI_AS_TESTER.md`](AI_AS_TESTER.md) |
| `docs:` | Technical writer | [`AI_AS_WRITER.md`](AI_AS_WRITER.md) |

1. A feature of work follows [`AI_WORKFLOW.md`](AI_WORKFLOW.md).

The product vocabulary is the glossary in
[`tech-docs/entitlement-assistant-proposal.md`](tech-docs/entitlement-assistant-proposal.md) §4.

## Hard rules

1. **Plan before implementing.** Explain the plan, then ask whether it is good to build.
2. **The owner decides; the assistant recommends.** Questions go in the chat reply, with options and a
   recommendation, not through a question tool.
3. **This repository is public.** It never names, describes, or quotes other private projects.
4. **Commit or push only when the owner asks.**
5. **Every session runs from the project directory**, so its transcript lands in the prompt history.

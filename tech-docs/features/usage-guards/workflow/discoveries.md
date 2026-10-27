# Usage Guards — Discoveries

| | |
| :--- | :--- |
| **Purpose** | What building usage-guards revealed, and the judgment calls made, for the owner's review. |
| **References** | • Spec: [`../usage-guards.verification-spec.md`](../usage-guards.verification-spec.md) |

| # | Kind | Discovery | Outcome |
| --- | --- | --- | --- |
| 1 | Correction (owner, 2026-10-27) | The owner's first idea derived the caps from Worker requests (5 million of the 10 million included each month). Requests and Workers AI neurons are separate meters, and only neurons can realistically be exceeded by a demo, so the one variable is the daily neuron budget, `AI_NEURONS_PER_DAY`. A Worker-request cap cannot be enforced economically inside the Worker (each count would be a Durable Object request, and a refused request is still billed); the protections there are sign-in per IP, sign-in for everything costly, and a billing notification. | Owner accepted. |
| 2 | Design | G2's derivation (40% of the day's model calls per employee) keeps at least 1 message while the assistant is on, and does not apply when it is off, so the kill switch answers with the allowance text instead of closing the connection. | Kept. |
| 3 | Design | The global count of model calls is one Durable Object (`DailyAllowanceObject`, keyed `model-calls`); each employee's daily messages, another per employee (`messages:<account>`). A Durable Object runs one request at a time, so two takes never both get the last one. A new Durable Object class needs migration tag `v2` in `wrangler.jsonc`. | Kept. |
| 4 | Design | Each model call is taken by a language-model middleware before the provider is called: a refused take throws `DailyAllowanceExhausted`, whose text the browser shows; no neuron is spent. | Kept; mutation-checked. |
| 5 | Test fix | The test helper parsed every response frame as JSON; a failed turn's frame carries plain text (`error: true`). | Fixed in `AgentConversation`. |
| 6 | Mutation checks | Killed: model calls never refused (G1), daily messages never refused (G2), sign-in never limited (G5), the output bound removed (G4). | — |
| 7 | Tooling | `npm run demo:reset -- --yes` drops every table, migrates, seeds with the passwords file and today's fixture day, and registers the bundled policy set. Run twice on a throwaway local database: 17 migrations, 153 identifiers, policy set active. The policy registration is now one function shared with `policies:register`. | Owner runs it on Neon (Claude Code's permission check refuses dropping the schema from the assistant). |
| 8 | Vocabulary (for review) | New names: port `DailyAllowance`; adapters `InMemoryDailyAllowance`, `DurableObjectDailyAllowance`, Durable Object `DailyAllowanceObject`; kernel `usageCapsOf`, `takeFromDay`; close reason `daily_limit` (4430); log `usage-cap-reached`; settings `AI_NEURONS_PER_DAY`, `NEURONS_PER_MODEL_CALL`. | Owner to review. |
| 9 | Deployment (2026-10-27) | Deployed `e8f667ec`; live: sign-in attempts 1–10 answered 401 and the 11th 429; the assistant answered. The owner ran `demo:reset` on Neon (17 migrations, 165 identifiers, policy set active at `213dd2f`); all eight reviewer accounts (`cf-`, `bc-`) signed in on the deployment with their roles. | Merged to `main`. |

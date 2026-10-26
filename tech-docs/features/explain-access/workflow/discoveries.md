# Explain Access — Discoveries

| | |
| :--- | :--- |
| **Purpose** | Everything the feature surfaced: defects, gaps, decisions, deferrals. |
| **Status** | Open items listed below |
| **References** | • Progress: [`progress.md`](progress.md) |

| # | Kind | Discovery | Disposition |
| --- | --- | --- | --- |
| 1 | Gap (spec update) | api.md A5 and `originAllowed` checked `Origin` only on non-GET requests, so a WebSocket upgrade (a GET) from another site was not refused. | Owner ruled D9: every upgrade carries the application's Origin; api.md A5 updated; enforced in P6. |
| 2 | Spec defect (spec update) | "Refusals that look identical run the same statements" could not hold: a refusal per candidate writes one audit record per match, so the number of writes revealed how many accounts matched. | Owner ruled D12: a principal without `account.read` is refused before any customer data is read; no-match lookups are audited (`support.no-matching-account`). |
| 3 | Stale document | The sign-in spec (D7) and sign-in diagram said plain HTTP is redirected at Cloudflare's edge and that the Worker does not run for static files; the Worker redirects and runs first. | Corrected with the spec update (480cf90). |
| 4 | Plan | The agent stack (Agents SDK, AI SDK, Workers AI provider, Workers test pool, a CEL library) is not yet in the project. | Spikes K1–K3 before P1. |
| 5 | Spike K1 (pass) | `@marcbachmann/cel-js` 8.0.0 (no dependencies, no runtime code generation) type-checks all 11 starting policies against the attribute schema in `workerd`, rejects an unknown attribute and a type mismatch, and evaluates `has()` on absent optional attributes. CEL integers are BigInt. | Adopted behind `PolicyExpressionEvaluator`; the PIP converts integers to BigInt. |
| 6 | Spike K2 (partial) | `@cloudflare/vitest-pool-workers` supports Vitest 4 only and is renamed `@cloudflare/vitest-plugin` (1.4.7, Vitest 4 or 5). Under it, an `AIChatAgent` Durable Object, a WebSocket, a scripted AI SDK model (`MockLanguageModelV4`), and a tool call all work. The `pg` driver cannot be loaded in that runtime (mixed module formats; Node built-ins unresolvable by the dependency optimizer). | Q1-A, as ruled: `[agent]` verification tests drive the agent's message handling as a plain class in Node against PostgreSQL; the Durable Object adapter is tested in the Workers runtime with its use-case port doubled; the end-to-end test covers the whole path. |
| 7 | Spike K2 (security) | `AIChatAgent` takes the whole message history from the client's `cf_agent_use_chat_request` frame, and accepts client frames that clear the chat, submit tool results, and approve tools. A browser could forge earlier assistant messages or tool results. | The case agent keeps the conversation server-side: from a request it takes only the newest user message's text; every other client frame (clear, tool result, tool approval, message updates) is refused and changes nothing (spec §3). Covered in P6 by the plain-class tests and the adapter test. |
| 8 | Spike K2 (packages) | `AIChatAgent` lives in `@cloudflare/ai-chat` (0.12.2); `agents` 0.30.1 requires `@modelcontextprotocol/client`, `sdk`, and `server` as peers. | Installed with the agent stack in P6. |
| 9 | Spike K3 (pass) | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) through `workers-ai-provider` 4.0.1 and AI SDK 7: SSO check 5/5, Globex list 5/5, Carol explanation 5/5, Initech lookup 2/5 (the spike's prompt listed account ids, so the model skipped the lookup). It sometimes repeats a tool call. The Workers AI binding works in `wrangler dev` with the existing OAuth scopes. | The real system prompt names no account ids; the agent bounds model steps per message. Deploy scopes are still checked at P8. |

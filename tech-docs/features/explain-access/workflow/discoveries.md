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

# Employee Sign-In — Discoveries

| | |
| :--- | :--- |
| **Purpose** | Everything the feature surfaced: defects, gaps, decisions, deferrals. |
| **Status** | Open items listed below |
| **References** | • Progress: [`progress.md`](progress.md) |

| # | Kind | Discovery | Disposition |
| --- | --- | --- | --- |
| 1 | Spec defect | S04c renewed a token already ending at the absolute lifetime, contradicting D2 and S04d. | Fixed before RED (S04c from a normal token; S04d and S04e use the capped one); reported to the owner. |
| 2 | Platform | Workers' WebCrypto caps PBKDF2 at 100,000 iterations. | PHC strings use 100,000; Argon2id or an identity provider listed in production-readiness. |
| 3 | Structure | Models need shared pure types (`Result`, branded ids) that `port/` cannot give them without breaking `model-has-no-io`. | Added `kernel/`, with its own rule; architect guide and rule register updated. |
| 4 | Structure | "Who am I" returns roles, which live in Access, above Account. | `GetSessionPrincipal` lives in Access over Account's `LoadPrincipal`; API doc updated. |
| 5 | Tooling | The dependency-cruiser exclude of `node_modules` hid every third-party import, so the "only external/ imports packages" rule could not fail. | Fixed; the rule was then proven by a probe. |
| 6 | Defect (smoke test) | The exported signing key's `key_ops` blocked importing its public half; a failed start was cached for the isolate's life and leaked a stack trace in development. | Fixed: `key_ops` and `ext` dropped on import; a failed start is retried and answers `500 server_error`. |
| 7 | Spec note | `Content-Length` values in the spec are computed with aliases; real ids are 18 bytes longer each. | Recorded in the spec's D6; tests compute the length from the actual body. |
| 8 | Test approach | The end-to-end test through `wrangler dev` was run by hand, not automated. | Deferred: automate with Wrangler's worker API when the agent connection arrives (explain-access). |
| 9 | Review (major) | Hyperdrive pools per transaction and resets session settings, so a session-level `SET ROLE` would not hold for later statements: the least-privilege role would be lost in production. | Fixed: one transaction per request, starting with `SET LOCAL ROLE`; a dedicated login role inside the application role in the deploy steps; a test proves the role holds inside a unit of work and only there. |
| 10 | Review (major) | Hyperdrive caches reads for 60 seconds by default, so a "fresh" principal could be stale. | Fixed in the deploy steps: Hyperdrive created with `--caching-disabled`; every request's reads now run inside a transaction. |
| 11 | Review (minor) | Sign-out did not re-load the principal; the re-check lived per handler. | Fixed: `authenticatePrincipal` in one tested request guard; regression test proven by a mutation. |
| 12 | Review (minor) | A correct password for a disabled employee ran more queries than a wrong one (timing). | Fixed: sign-in and `LoadPrincipal` run the same queries on every path, against `ABSENT_UUID` when nothing was found. |
| 13 | Review (minor) | `server_error` lacked the trace id api.md §3 requires. | Fixed: `x-trace-id` on `server_error` only; tested. |
| 14 | Review (minor) | The connection could leak; a database outage looked like a start failure; a failed `ROLLBACK` replaced the original error. | Fixed: the connection is opened inside the request's `try`, closed in `finally`; the work's error wins over a failed rollback. |
| 15 | Review (minor) | S04d, S04e, S04f did not assert the full Then. | Fixed: content type, length, body, and the S04d follow-up body asserted exactly. |
| 16 | Review (minor) | Origin and authentication rules sat inline in the composition root. | Fixed: `http/request-guard.ts` (`originAllowed`, `authenticateSession`, `authenticatePrincipal`), with tests; cookie lifetime computed in the Account model. |
| 17 | Review round 2 (minor) | Refusals with two reason codes ran one more statement than those with one (one `INSERT` per reason): a timing difference. | Fixed: reasons and participants are each written in one statement (`unnest`). |
| 18 | Review round 2 (minor) | The request transaction opened before the body was read, so a slow client could hold a pooled connection in an open transaction. | Fixed: the whole body (at most 16 KiB) is read before any connection opens; tested. |

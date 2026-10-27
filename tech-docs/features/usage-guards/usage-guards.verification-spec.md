# Usage Guards — Verification Spec

| | |
| :--- | :--- |
| **Purpose** | Caps that keep a public demo inside the account's included allowances, so nobody's use, or abuse, adds charges. |
| **Status** | Approved by the owner (2026-10-27): the guards, the values, the kill switch, the reviewer accounts |
| **Feature** | usage-guards · UG1–UG7 |

## 1. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **One variable sets the AI budget:** `AI_NEURONS_PER_DAY` (default 10,000, Workers AI's daily free allowance). With `NEURONS_PER_MODEL_CALL` (default 100, a conservative estimate to calibrate from the dashboard), it derives the **model calls per UTC day** (G1, global) = ⌊neurons ÷ neurons per call⌋, and the **messages per employee per UTC day** (G2) = ⌊model calls per day × 40%⌋. | Neurons are the meter a demo can exceed; Worker requests (10 million a month included) practically cannot. One knob, changed in `wrangler.jsonc`. |
| D2 | **G1, global:** every model call takes one from the day's count first; when none is left the call is not made and the turn answers "The assistant's daily allowance for this demo is used up; try again tomorrow (UTC)." | A cap the app enforces itself; nothing is billed past it. |
| D3 | **G2, per employee:** a message over the employee's daily count is refused before any work: the connection closes with `daily_limit`, and the chat says so. | One person, or one leaked credential, cannot spend the whole day. |
| D4 | **G3, per turn:** at most 1,024 output tokens per model call, at most 5 model calls per message (as now), and the model reads the latest 20 messages of the conversation. | A turn's cost is bounded, and a long conversation does not cost more and more. |
| D5 | **G4, kill switch:** `AI_NEURONS_PER_DAY = 0` refuses every turn without calling the model; sign-in, cases, and approvals keep working. | Off with one setting. |
| D6 | **G5, sign-in per IP address:** at most 10 attempts a minute per address (`cf-connecting-ip`); the 11th answers `429 rate_limited` whatever the password. | Sign-in is the costly route open to anyone (password hashing). |
| D7 | **Reviewer accounts:** `cf-alex` (representative, level 1), `cf-blair` (representative, level 2), `cf-morgan` (supervisor, level 2), `cf-sam` (supervisor, level 1), `@provider.example`, display names "Alex (cf)" and so on; deployed passwords are 24 random characters, given to reviewers privately. | Dedicated accounts, told apart in the audit trail; four roles show reads, Enterprise reads, approvals, and no self-approval. |

## 2. Scenarios

| # | Scenario | Then |
| --- | --- | --- |
| UG1 | The day's model calls are used up | The next message answers the allowance text; the model is not called; the next UTC day, it answers again. |
| UG2 | The kill switch | With 0 neurons a day, the first message answers the allowance text; the model is never called. |
| UG3 | An employee's daily messages are used up | Their next message closes the connection with `daily_limit`; another employee still chats; the next UTC day, they chat again. |
| UG4 | A turn's bounds | Every model call carries at most 1,024 output tokens; a conversation of 30 messages sends the model only the latest 20. |
| UG5 | Sign-in attempts from one address | The 11th within a minute is `429 rate_limited`, even with the right password; another address signs in. |
| UG6 | The derivation | 10,000 and 100 give 100 model calls and 40 messages; 0 gives 0 and 0. |
| UG7 | The reviewer accounts | The four `cf-` employees sign in with their roles. |

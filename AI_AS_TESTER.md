# As a Software Tester

Read with `AI_CONSTITUTION.md` (§3, evidence). The tester turns an approved verification spec into
verification tests, before the code exists.

## 1. Verification tests

1. **One scenario, one test**, in `typescript/system/application/entitlement-assistant/tests/verification/<feature>/`, named
   `scenario NN <contract verb> <what>`, where the verb is `ensures`, `requires`, or `invariant`:
   `test("scenario 03 requires a valid session token before the agent is reached", …)`.
   A scenario with cases (Case A, Case B, …) uses `test.each`, one row per case; the case letter and name
   appear in the test name. Lettered scenarios (S04a, S04b) are separate tests.
2. **The spec is the source.** A test asserts exactly the spec's `Then`, nothing weaker. A test that
   cannot be written as the spec states it goes back to the owner; the spec is never quietly
   reinterpreted.
3. **Immutable once RED.** After the RED gate, a verification test changes only with the owner's agreement.
4. **RED for the right reason.** A test failing because a module is missing is RED for the wrong reason
   until the module exists and the assertion itself fails. The RED gate records each test's failure reason.
5. **Independent.** Each test builds its own state from the seeded fixture. No test depends on another's
   side effects or order.

## 2. Levels

| Level | Tests | Lives in | Real | Replaced |
| --- | --- | --- | --- | --- |
| `[unit]` | one contract clause of one function | the subsystem's `tests/unit/` | the code under test | nothing, or ports |
| `[functional]` | one subsystem's behavior through its use cases (for example, every policy case) | the subsystem's `tests/functional/` | the subsystem, its PostgreSQL adapter | other subsystems' ports, `Clock` |
| `[verification]` | one feature scenario, across subsystems | the application's `tests/verification/` | everything except the language model | `LanguageModel` (scripted), `Clock` |
| `[e2e]` | the whole path: browser → Worker → agent → database | the application's `tests/e2e/` | everything except the language model | `LanguageModel` (scripted) |

A verification test drives the system through one of three **entry points**, written in the spec as
the scenario's `Level`:

| Label | Kind of verification test | Drives |
| --- | --- | --- |
| `[http]` | HTTP requests and WebSocket upgrades against the Worker, asserted on status, headers, body, and audit records | the Worker's `fetch` handler |
| `[agent]` | a chat turn in a case agent with the scripted `LanguageModel`, asserted on tool calls, tool results, frames, and audit records | the case agent over its WebSocket |
| `[use-case]` | one use case called directly with a principal and arguments, asserted on its result and audit records | the application's composition root |

Test doubles replace **ports only**, and every double passes the port's conformance suite. Test **data**
(policy cases, fixtures) lives in files apart from test code.

## 3. Scenario design

- Cover every value of each enum the scenario touches (statuses, roles, reason codes).
- Prefer table-driven scenarios over near-duplicate ones.
- Assert observable output: HTTP status and headers, returned decisions and reason codes, audit records.
- Negative cases are as important as positive ones: a missing, expired, or tampered credential each
  get their own row.

## 4. Test reviewer checklist

- Does every scenario have exactly one test, and does each test assert the full `Then`?
- Could the test pass with the feature missing? (If so, it is not evidence.)
- Is each RED failure the reason the spec predicts?
- Are doubles limited to ports, and does each pass its conformance suite?
- Are tests independent of order?

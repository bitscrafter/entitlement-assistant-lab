# Case Lifecycle — Progress

| | |
| :--- | :--- |
| **Status** | Merged into `main` @ 16d63fc (2026-10-27; GREEN 537 on `main`); deployed from `main` (`0c06f4f0`); the live check waits for Workers AI; discoveries 1–15 for the owner's review |
| **References** | • Plan: [`architect-plan.md`](architect-plan.md)<br>• Spec: [`../case-lifecycle.verification-spec.md`](../case-lifecycle.verification-spec.md)<br>• Discoveries: [`discoveries.md`](discoveries.md) |

| Phase | Role | Status | Outcome |
| --- | --- | --- | --- |
| Spec | owner | ✅ | approved 2026-10-26 (D1–D17, 28 scenarios) |
| Plan | architect | ✅ | approved 2026-10-26 with Q1–Q4 and the terms of §9; built autonomously from here (owner) |
| P1 schema, harness, RED | coder | ✅ | migration `support/002`; case-lifecycle test support; 53 tests over 28 scenarios: 47 fail on their assertions, 6 pass with mutations owed (discovery 4); S27k amended (discovery 1) |
| P2 authorization | coder | ✅ | governing permissions (D11) and lifecycle actions on suspended accounts (discoveries 2, 3), unit-tested |
| P3 support use cases | coder | ✅ | case assignee check, case action enforcement (combined decision, Q1), seven use cases, the subject rule in the read enforcement (Q2); authentication rules and the combined decision unit-tested |
| P4 endpoints, closing connections | coder | ✅ | five case routes and the closed-cases query, after-commit close of the case WebSocket connections over Durable Object RPC (K1 passed in the Workers runtime: S34b); 53/53 case-lifecycle tests; mutations: assignee, set once, subject rule, readable parts, summary, missing accounts (discovery 4) |
| P5 agent tools | coder | ✅ | `propose_case_subject`, `draft_case_summary`; snake_case results (D13) with the reply view following; 472 tests pass |
| P6 case panel | coder | ✅ | left of the chat: subject, contact (holds, roles), authentication (method, expiry; passed or failed), close form with the assistant's draft, past cases; **Set as case subject** and **Set as contact** on cards (discovery 7); the model's instructions name the two new tools |
| P7 deploy | coder | ✅ | Neon migrated (`support/002`); deployed `f7a75e73`; live smoke test of every endpoint passed, the close frame `4404` received (discovery 6) |
| GREEN gate | assistant | ✅ | 494 passed @ c3a218b; after the amendment, 511 pass on the working tree (formal gate at the next commit) |
| Adversarial review | review agent | ✅ | round 1: REJECT, 2 major (races), 7 minor, all fixed or ruled (8); round 2: ACCEPT, 4 minor, 2 fixed, 2 kept (9); amendment (10) reviewed in round 3: ACCEPT, 4 minor, all fixed (11); events amendment (12): round 4 REJECT (forged event lines), round 5 REJECT (names in the audit chain), round 6 ACCEPT, every finding fixed (13–15) |

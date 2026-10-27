# Grants and Approvals — Progress

| | |
| :--- | :--- |
| **Status** | P1–P7 done, GREEN, review round 1 fixed; P8 waits for the owner (commit, Morgan's seeding) |
| **References** | • Plan: [`architect-plan.md`](architect-plan.md)<br>• Spec: [`../grants-and-approvals.verification-spec.md`](../grants-and-approvals.verification-spec.md)<br>• Discoveries: [`discoveries.md`](discoveries.md) |

| Phase | Role | Status | Outcome |
| --- | --- | --- | --- |
| Spec | owner | ✅ | approved 2026-10-27 (D1–D17, 23 scenarios) |
| Plan | architect | ✅ | approved 2026-10-27 (Q1 B′, Q2–Q4, the transactional outbox, terms) |
| K1, K2 | architect | ✅ | Workflows and Cron triggers work in the test harness (discoveries 1, 2) |
| P1 schema, seed, harness, RED | coder | ✅ | migrations (outbox_message, grant extension, change requests and approvals); Morgan in the seed; grant test support and an approval process double; 41 tests, all failing on missing use cases, routes, and tools |
| P2 decisions with context | coder | ✅ | `DecisionRequest` carries `context` and `contactAccountId`; a System principal; the contact access step; EN-4 grant rules; D5's day count in the PIP; existing 537 tests green |
| P3 grants and the diff | coder | ✅ | `ChangeGrants` (create, revoke, extend as B′), `RecordGrantExpiries`; `EntitlementDiffs` (RFC 6902 with `test` operations); account versions |
| P4 change requests | coder | ✅ | prepare (preview), confirm (idempotent; apply or approval with an outbox message), cancel, read; closing a case cancels what is pending; D17 disclosure |
| P5 approvals and the process | coder | ✅ | list and decide (window checked in the deciding transaction), apply as the system with the re-run of D8, expire; the transactional outbox and its relay; the Workflow adapter and class; the Cron sweep |
| P6 agent and case events | coder | ✅ | three preparing tools; case events for every change and approval outcome; instructions; 41 RED tests green, plus event tests |
| P7 UI | coder | ✅ | the change request card (diff in words, preview, Confirm and Cancel, re-read after each click); the approvals panel (collapsible, count, 30 s refresh, approve or deny with a reason) |
| P8 deploy | coder | ⬜ | |
| GREEN gate | assistant | ✅ | 598 tests (537 before, 41 RED now green, 20 new), Biome, types, dependency rules; mutation checks on the security rules all killed (discovery 17) |
| Adversarial review | review agent | ✅ rounds 1–2 | round 1: 8 findings (1 High), 7 fixed, 1 open question (discoveries 20–28); round 2: no deadlock or double application, 6 findings fixed (29–32); 605 tests green |

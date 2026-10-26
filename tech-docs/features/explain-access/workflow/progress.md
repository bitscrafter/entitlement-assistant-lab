# Explain Access — Progress

| | |
| :--- | :--- |
| **Purpose** | The phase table of explain-access: role, status, outcome. |
| **Status** | P5 done; P6 next. The nine case-agent scenarios (S05e, S05i–S05m, S06a, S06b, S13) are skipped until P6 enables them (owner, 2026-10-25) |
| **References** | • Plan: [`architect-plan.md`](architect-plan.md)<br>• Spec: [`../explain-access.verification-spec.md`](../explain-access.verification-spec.md) |

| Phase | Role | Status | Outcome |
| --- | --- | --- | --- |
| Spec | owner | ✅ | approved 2026-10-25 (D9–D13, S05k–S05m added) |
| Plan | architect | ✅ | approved 2026-10-25 with every recommendation (Q1–Q5) and the proposed terms |
| K1 CEL in Workers | architect | ✅ | pass: `@marcbachmann/cel-js` (discovery 5) |
| K2 agent tests in the Workers pool | architect | ✅ | partial: agent and WebSocket work, `pg` does not; Q1-A applies (discoveries 6–8) |
| K3 Workers AI tool calling | architect | ✅ | pass (discovery 9) |
| P1 schema, seed, harness | coder | ✅ | seven migrations, catalog and customer seed with a fixture-day shift (mutation-proven), `[use-case]`, `[agent]`, and Workers-runtime harnesses, stub use cases and case agent |
| RED gate | tester | ✅ | 72 of 74 fail on their assertions (missing routes answer 404; stub use cases answer `NotFound`; no audit records, security events, tool calls, or closes). 2 pass: S05c and S08e case C, kept by the owner with mutations owed (discoveries 11, 12); S05j and S09a amended (13, 15) |
| P2 product and entitlement | coder | ✅ | catalog rules and remedies; `effectiveEntitlements` (EN-6) as one pure function, four rules proven by mutations; `GetCatalog`, `FindLowestPlanIncluding`, `GetCustomerAccount`, `ComputeEffectiveEntitlements` with their PostgreSQL adapters, checked over the seed |
| P3 policy | coder | ✅ | 11 policy files; build command (checks action keys and CEL types, refuses a broken set, proven); bundled set with content version; CEL evaluator; `EvaluatePolicies` failing closed when the set is inactive, re-checked once a minute; seed registers and activates; 33 case-file cases and the stale-bundle check, proven by mutations |
| P4 authorization | coder | ✅ | `AuthorizationDecider` port; the PDP as five strategy steps with early stop on suspension (AC-6 reads exempt); the per-decision PIP; finding combination; Customer Identity, Account, and Access lookups it needs; deny-by-default, early stop, and AC-6 proven by mutations; fail-closed on an inactive policy set |
| P5 support use cases, case endpoint | coder | ✅ | disclosure rule (AU-6); the read enforcement template with the permission gate (D12, proven by untouchable doubles and a mutation); `FindCustomerAccount`, `CheckEntitlement`, `ListEntitlements`, `ExplainAccess`, `OpenCase`; `POST /api/cases`; the upgrade route (D1, D9); S05a–S05d, S05f–S05h, S07–S12 green (discovery 18 fixed); S05c and S08e case C proven by mutations |
| P6 case agent | coder | ⬜ | |
| P7 chat UI | coder | ⬜ | |
| P8 end to end and deploy | coder | ⬜ | |
| GREEN gate | assistant | ⬜ | |
| Adversarial review | review agent | ⬜ | |

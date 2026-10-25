# AI Workflow — how a feature is built

A **feature** is a cohesive set of scenarios that is deployable on its own (proposal §7). This document
is the process. Role behavior lives in the `AI_AS_*` documents, and the bar in `AI_CONSTITUTION.md`.

## 1. The path of a feature

```text
proposal (scenarios grouped into features)
      ↓
verification spec          ← the owner approves this; nothing is built before it
      ↓
architect plan             ← phases, ports, adapters, data schema; reviewed
      ↓
verification tests         ← written from the spec; must FAIL (RED gate)
      ↓
for each phase of the plan:
      coder → code review   (the coder writes unit tests and contracts)
      docs updated in the same phase
      ↓
GREEN gate                 ← clean tree, every check below passes
      ↓
adversarial review         ← a fresh reviewer tries to refute the whole feature diff
      ↓
merge to main → deploy → close-out
```

- **Verification spec first.** It states what the feature must do, as scenarios with a complete
  `Given` and an exact `Then`. It is the owner's approval point. Design questions it raises go back
  to the owner before the plan starts.
- **Verification tests are immutable once RED.** Changing one needs the owner's agreement, because it
  changes what was approved.
- **Scenarios go green progressively** across phases; all of them must be green only at the GREEN gate.

## 2. Roles

| Role | Job | Who |
| --- | --- | --- |
| Architect | The feature plan: phases, ports, adapters, schema, the style each change applies | the assistant |
| Architect reviewer | Reviews the plan against the spec and the quality bar | review agent |
| Tester | Writes the verification tests from the spec | the assistant |
| Test reviewer | Checks the tests are faithful to the spec and fail for the right reason | review agent |
| Coder | Implements a phase, with unit tests and contracts | the assistant |
| Code reviewer | Reviews each phase | review agent |
| Technical writer | Specs, glossary, README, ADRs | the assistant |
| Adversarial reviewer | Tries to refute correctness, coverage, and the quality bar on the whole feature diff | review agent (strongest model) |

**Review loops.** A per-phase review may reject up to 3 times. After that, the work stops and goes to
the owner with the review record. The adversarial review has no round cap: it runs until a round
accepts. Each repair round must reduce the open findings; a round that adds findings is a signal to
stop and rethink.

**Demo mode (owner, 2026-10-25).** To finish the demo in time, the architect, test, and per-phase reviews are
self-reviews by the assistant; only the adversarial review of the whole feature runs as a review agent. The
RED and GREEN gates are unchanged.

**Review briefs are self-contained.** A reviewer gets the files in scope, the facts it needs, the
lenses to apply, and a tool budget — not the instruction to read the constitution.

## 3. Gates

Gates are run by the assistant, not by agents. Commands run from `typescript/system/`.

**RED gate:** the feature's verification tests run and every one fails, for the reason the spec
predicts. If any passes, nothing was missing, and the scenario is questioned before building.

**GREEN gate:** `git status --porcelain` is empty first, then:

```sh
npx biome ci --error-on-warnings
npx tsc --noEmit
npx depcruise src --config .dependency-cruiser.cjs
npx vitest run
```

Quote the result with its commit (`AI_CONSTITUTION.md` §3).

## 4. Records

Everything a feature produces lives under `tech-docs/features/<feature>/`:

| File | Kind | Content |
| --- | --- | --- |
| `<feature>.verification-spec.md` | durable | the approved scenarios |
| `workflow/architect-plan.md` | record | the plan and its review outcome |
| `workflow/progress.md` | record | phase table: role, status (✅ 🔄 ⬜ 🔴), outcome |
| `workflow/reviews/*.md` | record | each review's findings and disposition |
| `workflow/discoveries.md` | record | everything the feature surfaced: defects, gaps, decisions, deferrals |

Durable documents state what is always true. Records under `workflow/` are chronological and may
say what happened when.

## 5. Git

- One branch per feature: `feature/<feature>`. `main` only receives a feature that passed the GREEN gate and
  the adversarial review.
- Commit messages describe the change, not the process.
- Commit and push only when the owner asks.

## 6. Close-out

1. `AI_TODO.md`: the feature moves to Completed (one line, with the merge commit).
2. `AI_SESSION.md`: decisions and state.
3. `workflow/discoveries.md` reconciled: every item resolved, filed, or deferred by the owner.
4. Prompt history exported to `prompt-history/`.

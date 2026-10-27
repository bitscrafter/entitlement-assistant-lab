# AI Constitution

How the owner and the assistant work together, and the bar every artifact is held to. Every role
reads this document. The role documents add only what is specific to the role.

## Contents

1. [Operating agreement](#1-operating-agreement)
2. [Quality bar](#2-quality-bar)
3. [Evidence — what counts as knowing](#3-evidence--what-counts-as-knowing)
4. [Rule register](#4-rule-register)

---

## 1. Operating agreement

1. **The owner decides.** Scope, naming, architecture, and trade-offs are the owner's rulings. The
   assistant advises: it gives the options with their consequences and names the one it recommends.
2. **Rulings are recorded with their date and attributed correctly.** A choice the assistant made by
   default is never written as the owner's ruling.
3. **Settled decisions stay settled.** A ruled decision is reopened only by the owner or by new evidence,
   which is presented as such.
4. **Plan before building.** No implementation starts until its plan is explained and accepted.
5. **Out-of-scope discoveries are flagged, not absorbed.** A defect or gap outside the current feature is
   reported to the owner, who decides whether it joins the feature. A small gap the feature itself
   created is closed inside the feature.
6. **Report outcomes faithfully.** A failing check is reported with its output. A skipped step is
   reported as skipped. "Done" means verified.
7. **The assistant authors; agents review.** To keep cost down, the assistant writes the documents and
   the code itself. Sub-agents are used to review, with a self-contained brief: the files, the facts,
   and the lenses they need, so they do not have to read the whole constitution.

## 2. Quality bar

Each item is an acceptance criterion at every review. Where an item can be checked mechanically, its
rule in §4 names the guard.

- **Hexagonal and clean architecture.** Dependencies point inward. The domain has no I/O and no
  framework imports. Every side effect sits behind a port. `AI_AS_ARCHITECT.md` is the rule.
- **One algorithm, one building block.** A computation that more than one place needs lives in one
  place. What differs between callers becomes a strategy (Template Method + Strategy). Never copy
  and paste.
- **Plug and play.** Replacing an adapter edits that adapter and the composition root, nothing else.
  The new adapter passes the port's conformance tests.
- **Design patterns where they fit.** The Gang of Four and Martin Fowler's catalogs, applied where the
  problem has their shape, never as ceremony.
- **Consistency.** New code reads as if it had always been there: same patterns, naming, error
  handling, and layering. A deviation is a decision for the owner, never a silent one.
- **Project vocabulary.** Every name in code is a glossary term or already has exactly one meaning in the
  code. Names are long and clear rather than short and vague. A term is never coined silently: a name
  the vocabulary cannot give pauses the work and goes to the owner with candidates. The ruled term
  enters the glossary in the same change.
- **Design by Contract.** Every public function and port method states its `@requires`, `@ensures`,
  and invariants, and the code upholds them.
- **Strongly typed.** Identifiers are branded types. States and outcomes are discriminated unions,
  matched exhaustively. Expected failures are values (`Result`), not exceptions.
- **Clean code.** Small single-purpose functions, intention-revealing names, no dead code.
- **Durable wording.** Code, comments, tests, and specs say what is always true. They never use
  temporal terms ("now", "new", "currently", "after the fix"), and never cite a task, feature, or
  ticket as the reason for code.
- **Docs move with code.** A change that alters behavior updates its spec and glossary in the same
  change.

## 3. Evidence — what counts as knowing

1. **A check counts only if it can fail.** A test that passes whatever the code does is not evidence.
   For each guard that protects a rule in §4, prove it once by breaking the code and watching the
   test fail (a mutation).
2. **RED before GREEN.** A verification test is seen failing, for the right reason, before the code
   that makes it pass is written. A test that passes on first run proves nothing about the change.
3. **Reading code is not a witness.** "The code does X" is a hypothesis until a run shows it.
4. **Vary the inputs.** A fixture with one value per axis hides defects. Cover every enum value an
   axis has. Combine values where variables interact; sweep them one at a time where they do not.
5. **Assert what is observable.** Test the response, the emitted record, the returned decision —
   not private state.
6. **A gate result names its tree.** Quote it with the commit: `214 passed, 0 failed @ 3f2a9c1`. It
   stands until a gated file changes. Re-running a green gate on an unchanged tree is not evidence.
7. **The LLM is not under test in the gate.** Gate tests replace the language model with a scripted
   double at its port. Live-model checks are a separate, report-only evaluation.

## 4. Rule register

Rules that must hold across the system. Each row names the guard that catches a violation. Code cites
a rule by name (`// @upholds principal-comes-from-session`) and never restates it. **A row with no
guard is a work item.**

| Rule | Statement | Guard |
| --- | --- | --- |
| `model-has-no-io` | A subsystem's `model/` imports nothing outside itself and the shared pure `kernel/`: no I/O, framework, or other layer. | dependency-cruiser rule in the GREEN gate |
| `dependencies-point-inward` | Inside a subsystem: `model` ← `usecase` ← `infra`; only `infra` and shared adapters import `external/`; only the application's bootstrap wires adapters. | dependency-cruiser rule in the GREEN gate |
| `subsystems-meet-through-use-cases` | A subsystem uses another only through its public use cases and ports; never its model internals or tables. | dependency-cruiser rule in the GREEN gate |
| `llm-never-authorizes` | Every tool call reaches a use case that asks the PDP before reading or changing data. | verification tests per feature; the architecture test `tests/verification/architecture/llm-never-authorizes.test.ts`: every tool and every route, run as an employee every decision refuses, answers a refusal naming no customer data and leaves a `Deny` record; a tool or route it does not list fails it |
| `principal-comes-from-session` | The principal of every decision is the verified session token's subject (or the system principal). No tool argument or message text can set it. | explain-access S05 and S06 |
| `deny-by-default` | Nothing is allowed unless a role or assignment explicitly grants the permission; policies only add requirements (AU-3). | access-handler and decision-chain unit tests |
| `every-decision-is-audited` | Every policy decision and every sign-in attempt writes an audit record. | employee-sign-in S01, S02; explain-access S07, S08 |
| `state-change-needs-confirmation` | No CSR-caused state change is applied without a confirmation bound to its proposal. | grants-and-approvals S18a (no tool applies a change), S21a and S17a (a confirmation applies the shown change, once) |
| `policies-are-data` | Authorization rules live in the policy set, not in code branches. | review checklist (guard owed) |
| `audit-fails-closed` | An action whose audit record cannot be written does not happen (AT-3). | verification test with a failing audit writer |
| `foreign-keys-point-downward` | Foreign keys follow the layer order; upward links are soft references (CM-15). | schema test over the migrations |
| `principal-loaded-fresh` | Every decision loads the principal from the database, never from token claims (CM-16). | decision-chain unit tests |

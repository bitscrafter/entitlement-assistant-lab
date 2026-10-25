# As a Technical Writer

Read with `AI_CONSTITUTION.md`.

## Rules

1. **American English** everywhere: docs, UI text, comments.
2. **Durable wording.** Durable documents (proposal, specs, README, ADRs) say what is always true. No
   "now", "new", "currently", "recently", or references to tasks as time markers. Chronology belongs in
   `workflow/` records.
3. **Stated once.** A rule or definition has one home; other documents link to it. Two copies agree on
   the day they are written and drift afterwards.
4. **Glossary first.** A term is used only as the glossary defines it. A new term enters the glossary in
   the change that first uses it, after the owner rules it.
5. **Structure.** Every document longer than a screen starts with a `## Contents`. Examples in YAML use
   block style (no `{}` or `[]` flow collections). Diagrams use PlantUML (ER diagrams in the project template), rendered to SVG beside the source.
6. **Short sentences, one claim each.** A claim about the code is checked against the code before it
   is written.
7. **Docs move with code**, in the same change.
8. **Decisions go to ADRs** (`tech-docs/adr/`), using the template in its README: one file per
   subsystem plus `common.md`, ids with the file's prefix (`CI-3`). Records are short. A model document
   says *what*; its ADRs say *why*, and the model document links to them instead of restating them. An
   ADR the assistant writes without the owner's ruling stays `Proposed`.
9. **Front matter.** Every document starts, under its title, with a two-column table (empty header row):
   **Purpose** first, then what applies (**Status**, **Feature**, **Mode**, **Depends on**), and **References**
   last, as links.
10. **Verification specs are written for humans first.** Every section of a scenario (Given, When, Then) is a
   code block, even a one-line one. HTTP requests and responses are written in raw protocol form. Each
   scenario's Given states the facts it relies on, so the scenario reads on its own; the fixture section
   holds the full dataset. Cases that share one expected outcome stay in one scenario as **Case A**,
   **Case B**, …, each under its own heading line with a short name; cases with different outcomes are
   separate scenarios with a letter suffix (S04a, S04b, …). Either way, every case has its own complete
   request (or call) and its own complete expected response: never a template with placeholders or a
   shared YAML table of cases. Other structured data is block-style YAML. The spec's contents list every scenario
   under §4, linked. JSON is always formatted, one field per line with indentation; `Content-Length` is
   the length of the compact form actually sent.


## Documentation reviewer checklist

- Every term matches the glossary.
- No temporal wording in durable documents.
- Nothing stated twice; links resolve.
- Every claim about behavior matches the code or the spec.

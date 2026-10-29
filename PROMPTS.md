# Prompts

This project was built with Claude Code. The complete AI-assisted coding history is published, redacted, in
[`tech-docs/prompt-history/`](tech-docs/prompt-history/): every prompt of the owner, every reply, and one line per
tool call, in order.

| | |
| :--- | :--- |
| **Sessions** | • [`25dfabab…`](tech-docs/prompt-history/25dfabab-369d-49f1-ad74-167766a5779c.md), 2026-10-22 to 2026-10-25: the proposal, the data model, the ADRs, the API, employee sign-in, deployment<br>• [`ed96dfcc…`](tech-docs/prompt-history/ed96dfcc-84d8-4ec6-9d2f-f186a5768d60.md), 2026-10-26 onward: explain access, case lifecycle, grants and approvals, usage guards, the README and the demo scenarios |
| **How to read them** | `## Prompt` is the owner; `### Assistant` is Claude; `- tool …` lines are its tool calls, summarized. `## Agent report` is a separate agent the session started (adversarial reviews, fact-checks); `## Message` is another Claude session of the owner (the bitscrafter.com page about this project). `## Context summary` marks where a long session continued in a new context window. |
| **What was left out** | Tool outputs (file contents, command output), system reminders, background-task notices, and images; every secret value (passwords, keys, connection strings) and the owner's personal email; the names of the owner's other, private projects, and their sessions' messages. Paths are relative to the project; links lose their tracking parameters. |
| **How it was produced** | [`scripts/export_prompt_history.py`](scripts/export_prompt_history.py), from the transcripts Claude Code records. The raw transcripts stay private. |

## How the work was run

- **Rules first.** [`AI_CONSTITUTION.md`](AI_CONSTITUTION.md) holds the working agreement and its rule register;
  `AI_WORKFLOW.md` and the `AI_AS_*.md` role documents say how each kind of work is done. The owner decides; Claude
  recommends.
- **One feature at a time.** A verification spec approved by the owner, an architect plan, tests that fail first,
  the build in phases, then mutation checks of the security rules and adversarial reviews by a separate agent until
  nothing serious remained.
- **Judgment calls are written down.** Each feature's `workflow/discoveries.md` logs what building revealed and every
  decision taken without the owner, for the owner's review; `progress.md` records where each phase stood.
- **Live evidence.** The real model was evaluated against the deployment, and each feature's live check is
  recorded in its discoveries.

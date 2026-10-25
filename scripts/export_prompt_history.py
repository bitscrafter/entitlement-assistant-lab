#!/usr/bin/env python3
"""Export the Claude Code transcripts of this project into prompt-history/.

For each session transcript (JSONL) it writes:
  prompt-history/raw/<session-id>.jsonl   the transcript, with redactions applied
  prompt-history/<session-id>.md          a readable rendering: prompts, replies, tool calls

Usage:
  scripts/export_prompt_history.py [--transcripts-dir DIR ...] [--redact TEXT ...]

By default the transcripts directory is the Claude Code project folder of this repository's parent
directory, where sessions are started. Every --redact value is replaced by "[redacted]" in both outputs.
"""

import argparse
import json
import re
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIRECTORY = REPOSITORY_ROOT / "prompt-history"
SYSTEM_REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)


def default_transcripts_directory() -> Path:
    session_directory = str(REPOSITORY_ROOT.parent)
    project_slug = re.sub(r"[^A-Za-z0-9]", "-", session_directory)
    return Path.home() / ".claude" / "projects" / project_slug


def redact(text: str, redactions: list[str]) -> str:
    for redaction in redactions:
        text = text.replace(redaction, "[redacted]")
    return text


def content_blocks(message: dict) -> list[dict]:
    content = message.get("content", [])
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return content


def render_session(transcript_lines: list[dict]) -> str:
    rendered = []
    for entry in transcript_lines:
        entry_type = entry.get("type")
        if entry_type not in ("user", "assistant") or entry.get("isSidechain"):
            continue
        timestamp = entry.get("timestamp", "")
        for block in content_blocks(entry.get("message", {})):
            block_type = block.get("type")
            if entry_type == "user" and block_type == "text":
                prompt = SYSTEM_REMINDER.sub("", block.get("text", "")).strip()
                if prompt:
                    rendered.append(f"## Prompt — {timestamp}\n\n{prompt}\n")
            elif entry_type == "assistant" and block_type == "text":
                reply = block.get("text", "").strip()
                if reply:
                    rendered.append(f"### Assistant\n\n{reply}\n")
            elif entry_type == "assistant" and block_type == "tool_use":
                tool_input = block.get("input", {})
                summary = (
                    tool_input.get("description")
                    or tool_input.get("file_path")
                    or tool_input.get("command", "")[:120]
                )
                rendered.append(f"- tool `{block.get('name')}`: {summary}\n")
    return "\n".join(rendered)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--transcripts-dir",
        type=Path,
        action="append",
        help="a Claude Code project folder; repeat it when the sessions ran from more than one directory",
    )
    parser.add_argument("--redact", action="append", default=[])
    arguments = parser.parse_args()

    raw_directory = OUTPUT_DIRECTORY / "raw"
    raw_directory.mkdir(parents=True, exist_ok=True)

    directories = arguments.transcripts_dir or [default_transcripts_directory()]
    transcripts = sorted(path for directory in directories for path in directory.glob("*.jsonl"))
    for transcript in transcripts:
        text = redact(transcript.read_text(encoding="utf-8"), arguments.redact)
        (raw_directory / transcript.name).write_text(text, encoding="utf-8")
        lines = [json.loads(line) for line in text.splitlines() if line.strip()]
        markdown = f"# Session {transcript.stem}\n\n" + render_session(lines)
        (OUTPUT_DIRECTORY / f"{transcript.stem}.md").write_text(markdown, encoding="utf-8")
        print(f"exported {transcript.name}")
    print(f"{len(transcripts)} session(s) exported to {OUTPUT_DIRECTORY}")


if __name__ == "__main__":
    main()

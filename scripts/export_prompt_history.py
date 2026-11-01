#!/usr/bin/env python3
"""Export the Claude Code transcripts of this project for publication.

For each session transcript (JSONL) it writes:
  prompt-history/raw/<session-id>.jsonl      the transcript as recorded (git-ignored; never published)
  tech-docs/prompt-history/<session-id>.md    a readable rendering, redacted: prompts, replies, one line per tool call

Redaction, applied to the readable rendering:
  - every secret value found in the local secret files (passwords, connection strings, keys) becomes "[redacted]"
  - names of the owner's other, private projects become "[another project]"
  - messages from sessions of those projects are left out, with a note
  - system reminders, task notifications, and images are left out; tool outputs are never rendered
  - paths are relative to the project; links lose their tracking parameters

Usage:
  scripts/export_prompt_history.py [--transcripts-dir DIR ...] [--redact TEXT ...] [--private-project NAME ...]

By default the transcripts directory is the Claude Code project folder of this repository's parent directory, where
sessions are started. Every --redact value is also replaced by "[redacted]".
"""

import argparse
import json
import re
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
RAW_DIRECTORY = REPOSITORY_ROOT / "prompt-history" / "raw"
PUBLISHED_DIRECTORY = REPOSITORY_ROOT / "tech-docs" / "prompt-history"
SECRET_FILES = [
    REPOSITORY_ROOT / "typescript" / "system" / name
    for name in (".env.seed-passwords", ".env.neon", ".dev.vars", ".env.production-secrets.json")
]

SYSTEM_REMINDER = re.compile(r"<system-reminder[^>]*>.*?</system-reminder[^>]*>", re.DOTALL)
TASK_NOTIFICATION = re.compile(r"<task-notification>.*?</task-notification>", re.DOTALL)
CROSS_SESSION = re.compile(
    r"<cross-session-message[^>]*from-name=\"(?P<sender>[^\"]+)\"[^>]*>(?P<body>.*?)</cross-session-message>", re.DOTALL
)
AGENT_MESSAGE = re.compile(r"<agent-message[^>]*>(?P<body>.*?)</agent-message>", re.DOTALL)
HARNESS_FRAMING = re.compile(
    r"Another Claude session sent a message:|This came from another Claude session.*?(?=\n\n|\Z)"
    r"|That \"other Claude session\" is an agent.*?(?=\n\n|\Z)|\[Subagent hand-back\].*?The report follows:",
    re.DOTALL,
)
IMAGE_NOTE = re.compile(r"\[Image[^\]]*\]")

# The owner's other projects are private: their names never appear, and their sessions' messages are left out. The
# names are given on the command line (--private-project), so this script names none of them.
private_project_names: list[str] = []


def secret_values() -> list[str]:
    """Every secret value of the local secret files, longest first, and the password of each connection string."""
    values: set[str] = set()

    def add(value: str) -> None:
        value = value.strip().strip("'\"")
        if len(value) >= 8 and not value.startswith("http"):
            values.add(value)
            match = re.search(r"://[^:/@]+:([^@]+)@", value)
            if match:
                values.add(match.group(1))

    for path in SECRET_FILES:
        if not path.exists():
            continue
        if path.suffix == ".json":

            def walk(node: object) -> None:
                if isinstance(node, dict):
                    for child in node.values():
                        walk(child)
                elif isinstance(node, list):
                    for child in node:
                        walk(child)
                elif isinstance(node, str):
                    add(node)

            walk(json.loads(path.read_text(encoding="utf-8")))
        else:
            for line in path.read_text(encoding="utf-8").splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    add(line.split("=", 1)[1])
    return sorted(values, key=len, reverse=True)


# Links keep their page, not their tracking parameters.
TRACKED_LINK = re.compile(r"(https://job-boards\.greenhouse\.io/[^\s?)\]]+)\?[^\s)\]]*")
TEMPORARY_FILE = re.compile(r"/private/tmp/[^\s`'\")\]]+")


def path_replacements() -> list[tuple[str, str]]:
    """Absolute paths of this machine, rewritten relative to the project, computed here (no folder is written down)."""
    sessions_directory = REPOSITORY_ROOT.parent
    workspace = sessions_directory.parent.parent
    replacements = [
        (str(REPOSITORY_ROOT) + "/", ""),
        (str(REPOSITORY_ROOT), "."),
        # Sessions start in the directory above the repository; a typo of its name was used once.
        (str(sessions_directory).replace("cloudflare", "clooudflare") + "/", "../"),
        (str(sessions_directory) + "/", "../"),
        (str(sessions_directory), ".."),
        (str(workspace) + "/", "<workspace>/"),
        (str(Path.home()) + "/", "~/"),
    ]
    # Claude Code names a project's transcript folder after its absolute path.
    for directory in (str(sessions_directory).replace("cloudflare", "clooudflare"), str(sessions_directory)):
        replacements.insert(0, (re.sub(r"[^A-Za-z0-9]", "-", directory), "<this-project>"))
    return replacements


def redact(text: str, redactions: list[str]) -> str:
    for redaction in redactions:
        text = text.replace(redaction, "[redacted]")
    for name in private_project_names:
        text = re.sub(re.escape(name) + r"[-a-z0-9]*", "[another project]", text, flags=re.IGNORECASE)
    text = TRACKED_LINK.sub(r"\1", text)
    text = TEMPORARY_FILE.sub("[a temporary file]", text)
    for absolute, relative in path_replacements():
        text = text.replace(absolute, relative)
    return text


def content_blocks(message: dict) -> list[dict]:
    content = message.get("content", [])
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return content


def render_user_text(text: str) -> str:
    """A user turn as published: the owner's prompt, or a message from another session or agent, labeled."""
    text = TASK_NOTIFICATION.sub("", SYSTEM_REMINDER.sub("", text))
    text = IMAGE_NOTE.sub("*(an image)*", text)

    def cross_session(match: re.Match) -> str:
        sender = match.group("sender")
        if any(sender.lower().startswith(name.lower()) for name in private_project_names):
            return "\n*(A message from a session of another project, left out.)*\n"
        return f"\n**Message from another session ({sender}):**\n\n{match.group('body').strip()}\n"

    text = CROSS_SESSION.sub(cross_session, text)
    text = AGENT_MESSAGE.sub(
        lambda match: f"\n**Report from an agent of this session:**\n\n{match.group('body').strip()}\n", text
    )
    return HARNESS_FRAMING.sub("", text).strip()


def heading_of(text: str, timestamp: str) -> str:
    if text.startswith("This session is being continued"):
        return f"## Context summary — {timestamp}"
    if text.startswith("**Message from another session") or text.startswith("*(A message from"):
        return f"## Message — {timestamp}"
    if text.startswith("**Report from an agent"):
        return f"## Agent report — {timestamp}"
    return f"## Prompt — {timestamp}"


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
                prompt = render_user_text(block.get("text", ""))
                if prompt:
                    rendered.append(f"{heading_of(prompt, timestamp)}\n\n{prompt}\n")
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
    parser.add_argument(
        "--private-project",
        action="append",
        default=[],
        help="the name of a private project: its mentions become [another project], its sessions' messages are left out",
    )
    arguments = parser.parse_args()
    private_project_names.extend(arguments.private_project)

    RAW_DIRECTORY.mkdir(parents=True, exist_ok=True)
    PUBLISHED_DIRECTORY.mkdir(parents=True, exist_ok=True)
    redactions = secret_values() + arguments.redact

    directories = arguments.transcripts_dir or [default_transcripts_directory()]
    transcripts = sorted(path for directory in directories for path in directory.glob("*.jsonl"))
    for transcript in transcripts:
        text = transcript.read_text(encoding="utf-8")
        (RAW_DIRECTORY / transcript.name).write_text(text, encoding="utf-8")
        lines = [json.loads(line) for line in text.splitlines() if line.strip()]
        markdown = redact(f"# Session {transcript.stem}\n\n" + render_session(lines), redactions)
        (PUBLISHED_DIRECTORY / f"{transcript.stem}.md").write_text(markdown, encoding="utf-8")
        print(f"exported {transcript.name}")
    print(f"{len(transcripts)} session(s) exported to {PUBLISHED_DIRECTORY}")


def default_transcripts_directory() -> Path:
    session_directory = str(REPOSITORY_ROOT.parent)
    project_slug = re.sub(r"[^A-Za-z0-9]", "-", session_directory)
    return Path.home() / ".claude" / "projects" / project_slug


if __name__ == "__main__":
    main()

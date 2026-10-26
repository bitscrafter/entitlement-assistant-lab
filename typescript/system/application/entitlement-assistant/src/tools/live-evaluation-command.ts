import { readFile } from "node:fs/promises";
import { encodeIdentifier } from "../../../../kernel/identifier.ts";
import { seededUuid } from "../database/seed.ts";

/**
 * The live-model evaluation of explain-access (spec §5, report-only): each message is sent in a new case, as Blair,
 * `EVALUATION_RUNS` times (5 by default), and reported as pass rates for the expected tool call, an answer in words,
 * and names written as references (ADR CM-19). Each turn spends Workers AI's daily allocation (discovery 36).
 *
 * `EVALUATION_ORIGIN` is the application's origin (`https://…` or `http://localhost:8787`); `SEED_PASSWORDS_FILE` is
 * the file the seed read, so the password is never typed or printed.
 */
const origin = process.env.EVALUATION_ORIGIN;
const passwordsFile = process.env.SEED_PASSWORDS_FILE;
const runs = Number(process.env.EVALUATION_RUNS ?? "5");
if (origin === undefined || passwordsFile === undefined || !Number.isInteger(runs) || runs < 1) {
  console.error(
    "EVALUATION_ORIGIN and SEED_PASSWORDS_FILE are required; EVALUATION_RUNS is a positive integer.",
  );
  process.exit(1);
}
const EMAIL = "blair@provider.example";

interface ToolCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}
interface Turn {
  readonly calls: readonly ToolCall[];
  readonly answer: string;
  /** Why the turn produced no answer: an error frame, a close, or a timeout. */
  readonly failure: string | null;
  readonly seconds: number;
}

const accountId = (alias: string) => encodeIdentifier("acc", seededUuid(alias));
const ACME = accountId("acc_acme");
const LABS = accountId("acc_acme_labs");
const GLOBEX = accountId("acc_globex");
const lower = (value: unknown) => String(value ?? "").toLowerCase();
const called = (turn: Turn, tool: string, matches: (input: ToolCall["input"]) => boolean) =>
  turn.calls.some((call) => call.tool === tool && matches(call.input));

const MESSAGES: readonly { readonly message: string; readonly expected: (turn: Turn) => boolean }[] = [
  {
    message: "What plan is Initech on?",
    expected: (turn) =>
      called(turn, "find_customer_account", (input) => lower(input.query).includes("initech")),
  },
  {
    message: "Does Acme Corp have SSO?",
    expected: (turn) =>
      called(
        turn,
        "check_entitlement",
        (input) => input.account_id === ACME && lower(input.feature_key) === "sso",
      ),
  },
  {
    message: "Does Acme have SSO?",
    expected: (turn) =>
      (turn.answer.includes(`[${ACME}]`) && turn.answer.includes(`[${LABS}]`)) ||
      [ACME, LABS].every((account) =>
        called(
          turn,
          "check_entitlement",
          (input) => input.account_id === account && lower(input.feature_key) === "sso",
        ),
      ),
  },
  {
    message: "What is Globex entitled to?",
    expected: (turn) => called(turn, "list_entitlements", (input) => input.account_id === GLOBEX),
  },
  {
    message: "Why can't carol@acme.com create API tokens at Acme Corp?",
    expected: (turn) =>
      called(
        turn,
        "explain_access",
        (input) =>
          lower(input.person_email) === "carol@acme.com" &&
          input.account_id === ACME &&
          lower(input.feature_key) === "api-access" &&
          lower(input.operation) === "create-token",
      ),
  },
];

/** A tool call written as text: JSON (`{"name": …, "parameters": …}`) or Python-like (`[tool(…)]`). */
const TOOL_CALL_TEXT = /\{\s*"name"\s*:\s*"[A-Za-z_]+"\s*,\s*"parameters"\s*:|\[\s*[a-z_]+\(/;
/** A name of the fixture's accounts or people, outside a reference. */
const NAME_OUTSIDE_REFERENCE = /Initech|Acme|Globex|carol/i;
const inWords = (turn: Turn) =>
  turn.failure === null && turn.answer.trim() !== "" && !TOOL_CALL_TEXT.test(turn.answer);
const byReference = (turn: Turn) => !NAME_OUTSIDE_REFERENCE.test(turn.answer.replace(/\[[^\]\s]+\]/g, ""));

async function signIn(): Promise<string> {
  const passwords = await readFile(passwordsFile as string, "utf8");
  const password = passwords.match(/^blair@provider\.example=(.*)$/m)?.[1];
  if (password === undefined) throw new Error(`No password for ${EMAIL} in SEED_PASSWORDS_FILE.`);
  const response = await fetch(`${origin}/api/authentication/sign-in`, {
    method: "POST",
    headers: { Origin: origin as string, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  if (response.status !== 204) throw new Error(`Sign-in answered ${response.status}.`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function openCase(cookie: string): Promise<string> {
  const response = await fetch(`${origin}/api/cases`, {
    method: "POST",
    headers: { Origin: origin as string, "Content-Type": "application/json", Cookie: cookie },
    body: "{}",
  });
  if (response.status !== 201) throw new Error(`Opening a case answered ${response.status}.`);
  return ((await response.json()) as { case_id: string }).case_id;
}

/** One message in a new case, over the SDK's chat protocol, until the reply is done. */
function turn(cookie: string, caseId: string, message: string): Promise<Turn> {
  const started = Date.now();
  const calls: ToolCall[] = [];
  let answer = "";
  return new Promise((resolve) => {
    const finish = (failure: string | null) => {
      clearTimeout(timer);
      socket.close();
      resolve({ calls, answer, failure, seconds: (Date.now() - started) / 1000 });
    };
    // Node's WebSocket accepts headers as an extension; the server requires the application's Origin (D9).
    const socket = new WebSocket(`${(origin as string).replace(/^http/, "ws")}/agents/case-agent/${caseId}`, {
      headers: { Origin: origin, Cookie: cookie },
    } as never);
    const timer = setTimeout(() => finish("timeout"), 120_000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          type: "cf_agent_use_chat_request",
          id: crypto.randomUUID(),
          init: {
            method: "POST",
            body: JSON.stringify({
              messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: message }] }],
            }),
          },
        }),
      );
    socket.onclose = (event) => finish(`closed ${event.code}`);
    socket.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as {
        type?: string;
        body?: string;
        done?: boolean;
        error?: boolean;
      };
      if (frame.type !== "cf_agent_use_chat_response") return;
      if (frame.error === true) return finish(frame.body ?? "error");
      if (frame.body !== undefined && frame.body !== "") {
        const chunk = JSON.parse(frame.body) as {
          type?: string;
          toolName?: string;
          input?: unknown;
          delta?: string;
        };
        if (chunk.type === "tool-input-available")
          calls.push({ tool: chunk.toolName ?? "", input: (chunk.input ?? {}) as ToolCall["input"] });
        if (chunk.type === "text-delta") answer += chunk.delta ?? "";
      }
      if (frame.done === true) finish(null);
    };
  });
}

const cookie = await signIn();
for (const { message, expected } of MESSAGES) {
  const turns: Turn[] = [];
  for (let run = 0; run < runs; run += 1) turns.push(await turn(cookie, await openCase(cookie), message));
  const count = (test: (turn: Turn) => boolean) => `${turns.filter(test).length}/${runs}`;
  console.log(
    `${message}\n  expected ${count(expected)} · in words ${count(inWords)} · by reference ${count((t) => inWords(t) && byReference(t))}`,
  );
  for (const t of turns) {
    const tools = t.calls.map((call) => call.tool).join(" > ") || "no tool";
    console.log(
      `    ${t.seconds.toFixed(1)}s ${tools} | ${t.failure ?? t.answer.replaceAll("\n", " ").slice(0, 160)}`,
    );
  }
}

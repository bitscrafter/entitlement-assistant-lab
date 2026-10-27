import { afterEach, describe, expect, test } from "vitest";
import { userMessageFrame } from "../../support/agent-connection.ts";
import { at, insertCase, ORIGIN } from "../../support/harness.ts";
import type { ScriptedStep } from "../../support/scripted-language-model.ts";
import { createWorkerHarness, type WorkerHarness } from "../../support/worker-harness.ts";

const ALLOWANCE_TEXT = "The assistant's daily allowance for this demo is used up; try again tomorrow (UTC).";

/** One model call that drafts a summary (a tool with no reads), so a message can cost several calls. */
const draft = (id: string): ScriptedStep => ({
  text: "",
  toolCalls: [{ toolCallId: id, toolName: "draft_case_summary", arguments: { summary: "So far." } }],
});
const answer = (text: string): ScriptedStep => ({ text, toolCalls: [] });

describe("usage-guards in the case agent", () => {
  let harness: WorkerHarness | undefined;
  afterEach(async () => {
    await harness?.close();
  });

  test("UG1 and UG3 ensure the day's model calls and an employee's messages are capped, and reset the next UTC day", async () => {
    // 1,000 neurons ÷ 100 a call: 10 model calls a day, 4 messages an employee.
    harness = await createWorkerHarness(
      [
        draft("c1"),
        draft("c2"),
        answer("One."),
        draft("c3"),
        draft("c4"),
        answer("Two."),
        draft("c5"),
        draft("c6"),
        answer("Three."),
        draft("c7"),
        draft("c8"),
        answer("Never reached."),
      ],
      { neuronsPerDay: 1_000, neuronsPerModelCall: 100 },
    );
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
    const connection = await harness.connectAgent("cse_alex_1", "iac_alex");

    for (const [index, request] of ["request-1", "request-2", "request-3", "request-4"].entries()) {
      connection.send(userMessageFrame(`Message ${index + 1}.`, request));
      await connection.turnEnded(request);
    }

    expect(Number(await harness.control("language-model-calls", "cse_alex_1"))).toBe(10);
    expect(connection.errorTexts()).toEqual([ALLOWANCE_TEXT]);

    connection.send(userMessageFrame("Message 5.", "request-5"));
    await connection.closed();
    expect(connection.closedWith).toEqual({ code: 4430, reason: "daily_limit" });
    expect(Number(await harness.control("language-model-calls", "cse_alex_1"))).toBe(10);

    await harness.control("clock", "cse_alex_1", "2026-10-23T15:00:00Z");
    const tomorrow = await harness.connectAgent("cse_alex_1", "iac_alex", {
      issuedAt: new Date("2026-10-23T14:55:00Z"),
      expiresAt: new Date("2026-10-23T15:20:00Z"),
    });
    tomorrow.send(userMessageFrame("Message 6.", "request-6"));
    await tomorrow.turnEnded("request-6");
    expect(tomorrow.errorTexts()).toEqual([]);
    expect(tomorrow.replyText()).not.toBe("");
  });

  test("UG2 ensures the kill switch answers every message without calling the model", async () => {
    harness = await createWorkerHarness([answer("Never.")], { neuronsPerDay: 0, neuronsPerModelCall: 100 });
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
    const connection = await harness.connectAgent("cse_alex_1", "iac_alex");

    connection.send(userMessageFrame("Hello?"));
    await connection.turnEnded("request-1");

    expect(connection.errorTexts()).toEqual([ALLOWANCE_TEXT]);
    expect(Number(await harness.control("language-model-calls", "cse_alex_1"))).toBe(0);
  });

  test("UG4 ensures every model call is bounded to 1,024 output tokens", async () => {
    harness = await createWorkerHarness([draft("c1"), answer("Done.")]);
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
    const connection = await harness.connectAgent("cse_alex_1", "iac_alex");

    connection.send(userMessageFrame("Draft the summary."));
    await connection.turnEnded("request-1");

    expect(JSON.parse(await harness.control("max-output-tokens", "cse_alex_1"))).toEqual([1024, 1024]);
  });

  test("UG5 ensures sign-in attempts are capped per IP address", async () => {
    harness = await createWorkerHarness();
    const signIn = (address: string) =>
      harness?.fetch("/api/authentication/sign-in", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": address },
        body: JSON.stringify({ email: "alex@provider.example", password: "wrong" }),
      });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1)
      statuses.push((await signIn("203.0.113.7"))?.status ?? 0);
    const other = await signIn("203.0.113.8");

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(other?.status).toBe(401);
  });
});

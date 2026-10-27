import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeIdentifier } from "../../../../../kernel/identifier.ts";
import { seededUuid } from "../../../src/database/seed.ts";
import { userMessageFrame } from "../../support/agent-connection.ts";
import { at, auditRecords, external, insertCase, mintToken, ORIGIN, uuidOf } from "../../support/harness.ts";
import { createWorkerHarness, type WorkerHarness } from "../../support/worker-harness.ts";

const UPGRADE_HEADERS = {
  Origin: ORIGIN,
  Connection: "Upgrade",
  Upgrade: "websocket",
  "Sec-WebSocket-Version": "13",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
};

const tokenOf = (harness: WorkerHarness, alias: string) =>
  mintToken(harness.signingKey, {
    sub: external(alias),
    authTime: at("14:50:00"),
    iat: at("14:50:00"),
    exp: at("15:20:00"),
  });

const casePath = (alias: string) => `/agents/case-agent/${encodeIdentifier("cse", seededUuid(alias))}`;

/** Collects the frames a WebSocket receives until `until` holds for one of them. */
function framesUntil(
  socket: WebSocket,
  until: (frame: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>[]> {
  const frames: Record<string, unknown>[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${frames.length} frames`)), 15_000);
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      frames.push(frame);
      if (until(frame)) {
        clearTimeout(timer);
        resolve(frames);
      }
    });
  });
}

describe("explain-access in the Workers runtime", () => {
  let harness: WorkerHarness;
  beforeEach(async () => {
    harness = await createWorkerHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test("scenario 05e ensures the assignee connects to their case", async () => {
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));

    const response = await harness.fetch(casePath("cse_alex_1"), {
      headers: { ...UPGRADE_HEADERS, Cookie: `__Host-session=${await tokenOf(harness, "iac_alex")}` },
    });

    expect(response.status).toBe(101);
    expect(response.headers.get("upgrade")).toBe("websocket");
    expect(response.headers.get("connection")?.toLowerCase()).toBe("upgrade");
    expect(response.headers.get("sec-websocket-accept")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
    expect(await auditRecords(harness.owner)).toEqual([]);
  });

  test("scenario 13 ensures a case resumes after reconnecting, without re-running tools", async () => {
    await insertCase(harness.owner, "cse_blair_1", "iac_blair", at("14:00:00"));
    const cookie = `__Host-session=${await tokenOf(harness, "iac_blair")}`;

    const first = await harness.fetch(casePath("cse_blair_1"), {
      headers: { ...UPGRADE_HEADERS, Cookie: cookie },
    });
    expect(first.status).toBe(101);
    const firstSocket = first.webSocket as unknown as WebSocket;
    (first.webSocket as { accept(): void }).accept();
    const exchange = framesUntil(
      firstSocket,
      (frame) => frame.type === "cf_agent_use_chat_response" && frame.done === true,
    );
    firstSocket.send(userMessageFrame("Does Acme have SSO?"));
    await exchange;
    firstSocket.close(1000, "done");
    const recordsOfCase = async () =>
      (await auditRecords(harness.owner)).filter((record) => record.case_id === uuidOf("cse_blair_1"));
    const prior = await recordsOfCase();
    expect(
      prior.map((record) => [
        record.action_key,
        record.audit_outcome,
        record.subject_account_id,
        record.detail,
      ]),
    ).toEqual([
      ["account.read", "Allow", uuidOf("acc_acme"), { use_case: "CheckEntitlement", tool_call_id: "call_1" }],
    ]);
    const callsBefore = Number(await (await harness.fetch("/__test/language-model-calls")).text());

    const second = await harness.fetch(casePath("cse_blair_1"), {
      headers: { ...UPGRADE_HEADERS, Cookie: cookie },
    });

    expect(second.status).toBe(101);
    expect(second.headers.get("sec-websocket-accept")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    const secondSocket = second.webSocket as unknown as WebSocket;
    const restored = framesUntil(secondSocket, (frame) => frame.type === "cf_agent_chat_messages");
    (second.webSocket as { accept(): void }).accept();
    const conversation = (await restored).at(-1)?.messages as {
      role: string;
      parts: { type: string; text?: string; toolCallId?: string; output?: unknown }[];
    }[];
    expect(conversation.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(conversation[0]?.parts).toEqual([{ type: "text", text: "Does Acme have SSO?" }]);
    const [toolPart, replyPart] = conversation[1]?.parts.filter((part) => part.type !== "step-start") ?? [];
    expect(toolPart).toMatchObject({
      type: "tool-check_entitlement",
      toolCallId: "call_1",
      state: "output-available",
    });
    expect(replyPart).toMatchObject({
      type: "text",
      text: "Yes. Acme Corp has SSO through its Business plan.",
    });
    secondSocket.close(1000, "done");
    expect(await recordsOfCase()).toEqual(prior);
    expect(Number(await (await harness.fetch("/__test/language-model-calls")).text())).toBe(callsBefore);
  });
});

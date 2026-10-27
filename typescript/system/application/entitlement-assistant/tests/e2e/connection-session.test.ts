import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeIdentifier } from "../../../../kernel/identifier.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { userMessageFrame } from "../support/agent-connection.ts";
import { at, auditRecords, external, insertCase, mintToken, ORIGIN, uuidOf } from "../support/harness.ts";
import type { RawWebSocket } from "../support/raw-websocket.ts";
import { createWorkerHarness, type WorkerHarness } from "../support/worker-harness.ts";

describe("the connection session in the Workers runtime", () => {
  let harness: WorkerHarness;
  beforeEach(async () => {
    harness = await createWorkerHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test("invariant a session header sent by the client is never the connection's session", async () => {
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
    const token = await mintToken(harness.signingKey, {
      sub: external("iac_alex"),
      authTime: at("14:50:00"),
      iat: at("14:50:00"),
      exp: at("15:20:00"),
    });
    const forged = JSON.stringify({
      caseId: seededUuid("cse_alex_1"),
      principalAccountId: uuidOf("iac_sam"),
      sessionId: uuidOf("iac_sam"),
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const response = (await harness.fetch(
      `/agents/case-agent/${encodeIdentifier("cse", seededUuid("cse_alex_1"))}`,
      {
        headers: {
          Origin: ORIGIN,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          Cookie: `__Host-session=${token}`,
          "X-Connection-Session": forged,
        },
      },
    )) as unknown as { status: number; webSocket: RawWebSocket };
    expect(response.status).toBe(101);

    const done = new Promise<void>((resolve) =>
      response.webSocket.addEventListener("message", (event) => {
        const frame = JSON.parse(event.data) as { type: string; done?: boolean };
        if (frame.type === "cf_agent_use_chat_response" && frame.done === true) resolve();
      }),
    );
    response.webSocket.send(userMessageFrame("Does Acme have SSO?"));
    await done;
    response.webSocket.close(1000, "done");

    const records = await auditRecords(harness.owner);
    expect(records.map((record) => record.actor_account_id)).toEqual([uuidOf("iac_alex")]);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userMessageFrame } from "../../support/agent-connection.ts";
import { specAuditRecords, validToken } from "../../support/explain-access.ts";
import { at, decodePart, insertCase, ORIGIN, parseSetCookie, placeHold } from "../../support/harness.ts";
import { createWorkerHarness, type WorkerHarness } from "../../support/worker-harness.ts";

describe("explain-access connection lifetime", () => {
  let harness: WorkerHarness;
  beforeEach(async () => {
    harness = await createWorkerHarness([]);
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  const modelCalls = async (caseAlias = "cse_alex_1") =>
    Number(await harness.control("language-model-calls", caseAlias));
  const sendAfterClose = (send: () => void) => {
    try {
      send();
    } catch {
      // The connection is closed: nothing can be sent, which is what the scenario checks.
    }
  };

  test("scenario 05i ensures the server closes an agent connection when its session token expires", async () => {
    const connection = await harness.connectAgent("cse_alex_1", "iac_alex");
    await connection.settle();
    // Scheduled on the agent's clock at 15:00:00: the token's exp, 15:20:00, is 1,200 seconds away.
    expect(JSON.parse(await harness.control("schedules", "cse_alex_1"))).toEqual([
      { callback: "closeExpiredConnections", delay_seconds: 1200 },
    ]);

    await harness.control("clock", "cse_alex_1", "2026-10-22T15:20:00Z");
    await harness.control("run-schedules", "cse_alex_1");
    await connection.closed();
    expect(connection.closedWith).toEqual({ code: 4401, reason: "session_expired" });

    sendAfterClose(() => connection.send(userMessageFrame("Does Acme have SSO?")));
    await connection.settle();
    expect(await modelCalls()).toBe(0);
    expect(await specAuditRecords(harness)).toEqual([]);
  });

  test("scenario 05j ensures renewing the cookie does not extend an open connection", async () => {
    const first = await harness.connectAgent("cse_alex_1", "iac_alex");

    await harness.control("clock", "cse_alex_1", "2026-10-22T15:10:00Z");
    const renewal = await harness.fetch("/api/authentication/session/renewal", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: `__Host-session=${await validToken(harness, "iac_alex")}` },
    });
    const renewed = parseSetCookie(renewal.headers.get("set-cookie"));
    expect(renewed).not.toBeNull();
    expect(new Date(Number(decodePart(renewed?.value ?? "", 1).exp) * 1000)).toEqual(at("15:40:00"));

    await harness.control("clock", "cse_alex_1", "2026-10-22T15:20:00Z");
    await harness.control("close-expired", "cse_alex_1");
    await first.closed();
    expect(first.closedWith).toEqual({ code: 4401, reason: "session_expired" });

    const second = await harness.connectAgent("cse_alex_1", "iac_alex", {
      sessionToken: renewed?.value ?? "",
    });
    await second.settle();
    expect(second.closedWith).toBeNull();
    // The renewal at 15:10 is its own action (employee-sign-in S04b); neither the close nor the connection is one.
    expect(
      (await specAuditRecords(harness)).filter((record) => record.action_key !== "session.renew"),
    ).toEqual([]);
  });

  test("scenario 05k ensures a principal suspended during a connection is disconnected at its next message", async () => {
    const connection = await harness.connectAgent("cse_alex_1", "iac_alex");
    await placeHold(harness.owner, "iac_alex", "OperationalSuspension", at("15:05:00"));
    await harness.control("clock", "cse_alex_1", "2026-10-22T15:10:00Z");

    connection.send(userMessageFrame("Does Acme have SSO?"));
    await connection.closed();

    expect(connection.closedWith).toEqual({ code: 4401, reason: "invalid_session" });
    expect(await modelCalls()).toBe(0);
    expect(await specAuditRecords(harness)).toEqual([]);
    expect(JSON.parse(await harness.control("security-events", "cse_alex_1"))).toEqual(["PrincipalInactive"]);
  });

  test("scenario 05l ensures an oversized message closes the connection before the model sees it", async () => {
    const connection = await harness.connectAgent("cse_alex_1", "iac_alex");
    const empty = userMessageFrame("");
    const frame = userMessageFrame("x".repeat(16_385 - new TextEncoder().encode(empty).length));
    expect(new TextEncoder().encode(frame).length).toBe(16_385);

    connection.send(frame);
    await connection.closed();

    expect(connection.closedWith).toEqual({ code: 1009, reason: "message_too_big" });
    expect(await modelCalls()).toBe(0);
    expect(await specAuditRecords(harness)).toEqual([]);
  });

  test("scenario 05m ensures messages past the rate limit close the connection before the model sees them", async () => {
    await insertCase(harness.owner, "cse_alex_2", "iac_alex", at("14:00:00"));
    const first = await harness.connectAgent("cse_alex_1", "iac_alex");
    const second = await harness.connectAgent("cse_alex_2", "iac_alex");

    for (let index = 0; index < 10; index += 1) {
      const instant = new Date(at("15:00:00").getTime() + index * 3000).toISOString();
      await harness.control("clock", "cse_alex_1", instant);
      await harness.control("clock", "cse_alex_2", instant);
      first.send(userMessageFrame(`Message ${index} on case 1`, `case-1-${index}`));
      await first.turnEnded(`case-1-${index}`);
      second.send(userMessageFrame(`Message ${index} on case 2`, `case-2-${index}`));
      await second.turnEnded(`case-2-${index}`);
    }
    expect(first.replyText()).toBe("Noted.".repeat(10));
    expect(second.replyText()).toBe("Noted.".repeat(10));

    await harness.control("clock", "cse_alex_1", "2026-10-22T15:00:40Z");
    first.send(userMessageFrame("One more", "case-1-extra"));
    await first.closed();

    expect(first.closedWith).toEqual({ code: 4429, reason: "rate_limited" });
    expect(await modelCalls("cse_alex_1")).toBe(20);
    await second.settle();
    expect(second.closedWith).toBeNull();
    expect(await specAuditRecords(harness)).toEqual([]);
  });
});

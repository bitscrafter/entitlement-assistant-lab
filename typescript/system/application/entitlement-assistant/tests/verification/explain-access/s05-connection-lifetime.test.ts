import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CaseAgent } from "../../../src/agent/case-agent.ts";
import { userMessageFrame } from "../../support/agent-connection.ts";
import { specAuditRecords, validToken } from "../../support/explain-access.ts";
import {
  at,
  caseAgentFor,
  connectAs,
  createHarness,
  decodePart,
  type Harness,
  insertCase,
  ORIGIN,
  parseSetCookie,
  placeHold,
  request,
} from "../../support/harness.ts";
import { ScriptedLanguageModel } from "../../support/scripted-language-model.ts";

describe.skip("explain-access connection lifetime", () => {
  let harness: Harness;
  let model: ScriptedLanguageModel;
  let agent: CaseAgent;
  beforeEach(async () => {
    harness = await createHarness();
    model = new ScriptedLanguageModel();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
    agent = caseAgentFor(harness, "cse_alex_1", model);
  });
  afterEach(async () => {
    await harness.close();
  });

  test("scenario 05i ensures the server closes an agent connection when its session token expires", async () => {
    const connection = await connectAs(agent, "iac_alex", at("15:20:00"));

    harness.clock.setTo(at("15:20:00"));
    await agent.alarm();
    expect(connection.closedWith).toEqual({ code: 4401, reason: "session_expired" });

    await agent.receive(connection, userMessageFrame("Does Acme have SSO?"));
    expect(model.calls).toBe(0);
    expect(await specAuditRecords(harness)).toEqual([]);
  });

  test("scenario 05j ensures renewing the cookie does not extend an open connection", async () => {
    const first = await connectAs(agent, "iac_alex", at("15:20:00"), "connection-first");

    harness.clock.setTo(at("15:10:00"));
    const renewal = await harness.application.fetch(
      request("POST", "/api/authentication/session/renewal", {
        headers: { Origin: ORIGIN, Cookie: `__Host-session=${await validToken(harness, "iac_alex")}` },
      }),
    );
    const renewed = parseSetCookie(renewal.headers.get("set-cookie"));
    expect(renewed).not.toBeNull();
    const renewedExpiry = new Date(Number(decodePart(renewed?.value ?? "", 1).exp) * 1000);
    expect(renewedExpiry).toEqual(at("15:40:00"));

    harness.clock.setTo(at("15:20:00"));
    await agent.alarm();
    expect(first.closedWith).toEqual({ code: 4401, reason: "session_expired" });

    const second = await connectAs(agent, "iac_alex", renewedExpiry, "connection-second");
    expect(second.closedWith).toBeNull();
    // The renewal at 15:10 is its own action (employee-sign-in S04b); neither the close nor the connection is one.
    expect(
      (await specAuditRecords(harness)).filter((record) => record.action_key !== "session.renew"),
    ).toEqual([]);
  });

  test("scenario 05k ensures a principal suspended during a connection is disconnected at its next message", async () => {
    const connection = await connectAs(agent, "iac_alex", at("15:20:00"));
    await placeHold(harness.owner, "iac_alex", "OperationalSuspension", at("15:05:00"));
    harness.clock.setTo(at("15:10:00"));

    await agent.receive(connection, userMessageFrame("Does Acme have SSO?"));

    expect(connection.closedWith).toEqual({ code: 4401, reason: "invalid_session" });
    expect(model.calls).toBe(0);
    expect(await specAuditRecords(harness)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["PrincipalInactive"]);
  });

  test("scenario 05l ensures an oversized message closes the connection before the model sees it", async () => {
    const connection = await connectAs(agent, "iac_alex", at("15:20:00"));
    const empty = userMessageFrame("");
    const frame = userMessageFrame("x".repeat(16_385 - new TextEncoder().encode(empty).length));
    expect(new TextEncoder().encode(frame).length).toBe(16_385);

    await agent.receive(connection, frame);

    expect(connection.closedWith).toEqual({ code: 1009, reason: "message_too_big" });
    expect(model.calls).toBe(0);
    expect(await specAuditRecords(harness)).toEqual([]);
  });

  test("scenario 05m ensures messages past the rate limit close the connection before the model sees them", async () => {
    await insertCase(harness.owner, "cse_alex_2", "iac_alex", at("14:00:00"));
    const secondAgent = caseAgentFor(harness, "cse_alex_2", model);
    const first = await connectAs(agent, "iac_alex", at("15:20:00"), "connection-case-1");
    const second = await connectAs(secondAgent, "iac_alex", at("15:20:00"), "connection-case-2");

    for (let index = 0; index < 10; index += 1) {
      harness.clock.setTo(new Date(at("15:00:00").getTime() + index * 3000));
      await agent.receive(first, userMessageFrame(`Message ${index} on case 1`, `case-1-${index}`));
      await secondAgent.receive(second, userMessageFrame(`Message ${index} on case 2`, `case-2-${index}`));
    }
    expect(first.replyText()).toBe("Noted.".repeat(10));
    expect(second.replyText()).toBe("Noted.".repeat(10));

    harness.clock.setTo(at("15:00:40"));
    await agent.receive(first, userMessageFrame("One more", "case-1-extra"));

    expect(first.closedWith).toEqual({ code: 4429, reason: "rate_limited" });
    expect(model.calls).toBe(20);
    expect(second.closedWith).toBeNull();
    expect(await specAuditRecords(harness)).toEqual([]);
  });
});

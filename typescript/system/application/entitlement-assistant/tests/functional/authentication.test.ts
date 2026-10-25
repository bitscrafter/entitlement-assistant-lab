import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  at,
  auditRecords,
  compact,
  createHarness,
  type Harness,
  mintToken,
  ORIGIN,
  parseSetCookie,
  placeHold,
  request,
  uuidOf,
} from "../support/harness.ts";

describe("authentication endpoints", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  const signIn = () =>
    harness.application.fetch(
      request("POST", "/api/authentication/sign-in", {
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: compact({ email: "alex@provider.example", password: "alex-demo-password" }),
      }),
    );

  test("ensures nothing happens unaudited: when the audit record cannot be written, sign-in fails (rule audit-fails-closed)", async () => {
    await harness.owner.query("REVOKE INSERT ON audit_chain_record FROM entitlement_assistant_app");
    const response = await signIn();
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await auditRecords(harness.owner)).toEqual([]);
  });

  test("ensures sign-out clears the cookie and is audited", async () => {
    const token = await mintToken(harness.signingKey, {
      authTime: at("14:50:00"),
      iat: at("14:50:00"),
      exp: at("15:20:00"),
    });
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-out", {
        headers: { Origin: ORIGIN, Cookie: `__Host-session=${token}` },
      }),
    );
    expect(response.status).toBe(204);
    const cookie = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookie?.value).toBe("");
    expect(cookie?.attributes.get("max-age")).toBe("0");
    const records = await auditRecords(harness.owner);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action_key: "session.sign-out",
      actor_account_id: uuidOf("iac_alex"),
      audit_outcome: "Succeeded",
    });
  });

  test("ensures sign-out re-loads the principal: a suspended account gets 401 and nothing is audited", async () => {
    await placeHold(harness.owner, "iac_alex", "OperationalSuspension", at("14:55:00"));
    const token = await mintToken(harness.signingKey, {
      authTime: at("14:50:00"),
      iat: at("14:50:00"),
      exp: at("15:20:00"),
    });
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-out", {
        headers: { Origin: ORIGIN, Cookie: `__Host-session=${token}` },
      }),
    );
    expect(response.status).toBe(401);
    expect(await auditRecords(harness.owner)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["PrincipalInactive"]);
  });

  test("ensures an unexpected failure answers server_error with the trace id, and nothing else", async () => {
    await harness.owner.query("REVOKE INSERT ON audit_chain_record FROM entitlement_assistant_app");
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-in", {
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
        body: compact({ email: "alex@provider.example", password: "alex-demo-password" }),
      }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-trace-id")).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(await response.json()).toEqual({
      error: "server_error",
      error_description: "An unexpected error occurred.",
    });
  });

  test("ensures a state-changing request from another origin is refused before any use case", async () => {
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-in", {
        headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
        body: compact({ email: "alex@provider.example", password: "alex-demo-password" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "forbidden",
      error_description: "The request is not allowed.",
    });
    expect(await auditRecords(harness.owner)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["ForeignOrigin"]);
  });

  test.each([
    ["no JSON content type", { "Content-Type": "text/plain" }, compact({ email: "a", password: "b" })],
    [
      "an unknown field",
      { "Content-Type": "application/json" },
      compact({ email: "a", password: "b", role: "admin" }),
    ],
    [
      "a malformed account id",
      { "Content-Type": "application/json" },
      compact({ email: "a", password: "b", account_id: "acc_x" }),
    ],
    ["a body that is not JSON", { "Content-Type": "application/json" }, "{"],
  ])("ensures a sign-in with %s is an invalid request", async (_name, headers, body) => {
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-in", { headers: { Origin: ORIGIN, ...headers }, body }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_request",
      error_description: "The request is malformed.",
    });
  });

  test("ensures a body over 16 KiB is refused before any work", async () => {
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-in", {
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: compact({ email: "alex@provider.example", password: "x".repeat(17 * 1024) }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await auditRecords(harness.owner)).toEqual([]);
  });

  test("ensures an unknown route is not found", async () => {
    const response = await harness.application.fetch(request("GET", "/api/unknown"));
    expect(response.status).toBe(404);
  });
});

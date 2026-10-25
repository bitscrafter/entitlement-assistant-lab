import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { decodeIdentifier } from "../../../../../kernel/identifier.ts";
import {
  at,
  auditRecords,
  compact,
  createHarness,
  decodePart,
  external,
  type Harness,
  ORIGIN,
  parseSetCookie,
  request,
  uuidOf,
} from "../../support/harness.ts";

const HSTS = "max-age=31536000; includeSubDomains";
const seconds = (instant: Date) => instant.getTime() / 1000;

describe("employee-sign-in", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test("scenario 01 ensures an employee signs in and the session acts as their internal account", async () => {
    const response = await harness.application.fetch(
      request("POST", "/api/authentication/sign-in", {
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: compact({ email: "alex@provider.example", password: "alex-demo-password" }),
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("strict-transport-security")).toBe(HSTS);
    const cookie = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookie?.name).toBe("__Host-session");
    expect(Object.fromEntries(cookie?.attributes ?? [])).toEqual({
      httponly: true,
      secure: true,
      samesite: "Strict",
      path: "/",
      "max-age": "1800",
    });

    const token = cookie?.value ?? "";
    expect(decodePart(token, 0).alg).toBe("ES256");
    const claims = decodePart(token, 1);
    expect(claims.iss).toBe("entitlement-agent");
    expect(claims.aud).toBe("entitlement-agent");
    expect(claims.sub).toBe(external("iac_alex"));
    expect(claims.sid).toMatch(/^ses_[A-Za-z0-9_-]{22}$/);
    expect(claims.iat).toBe(seconds(at("15:00:00")));
    expect(claims.auth_time).toBe(claims.iat);
    expect(claims.exp).toBe(seconds(at("15:30:00")));
    expect(claims.jti).toMatch(/^jti_[A-Za-z0-9_-]{22}$/);
    expect(claims).not.toHaveProperty("roles");

    const records = await auditRecords(harness.owner);
    const sessionId = decodeIdentifier("ses", String(claims.sid));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action_key: "session.sign-in",
      actor_account_id: uuidOf("iac_alex"),
      audit_outcome: "Succeeded",
      session_id: sessionId.ok ? sessionId.value : "undecodable",
    });

    const principal = await harness.application.fetch(
      request("GET", "/api/authentication/session", { headers: { Cookie: `__Host-session=${token}` } }),
    );
    const body = compact({
      account_id: external("iac_alex"),
      display_name: "Alex",
      department: "customer-support",
      job_function: "representative",
      job_level: 1,
      roles: ["support-case-handling"],
    });
    expect(principal.status).toBe(200);
    expect(principal.headers.get("content-type")).toBe("application/json");
    expect(principal.headers.get("content-length")).toBe(String(new TextEncoder().encode(body).length));
    expect(await principal.text()).toBe(body);
  });
});

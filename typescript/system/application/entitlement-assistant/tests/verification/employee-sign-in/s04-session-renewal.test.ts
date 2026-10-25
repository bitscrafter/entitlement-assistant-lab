import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeIdentifier } from "../../../../../kernel/identifier.ts";
import { seededUuid } from "../../../src/database/seed.ts";
import {
  at,
  auditRecords,
  compact,
  createHarness,
  decodePart,
  external,
  type Harness,
  mintToken,
  ORIGIN,
  parseSetCookie,
  placeHold,
  request,
  uuidOf,
} from "../../support/harness.ts";

const AUTH_TIME = at("08:00:00");
const SESSION = seededUuid("session-s");
const SID = encodeIdentifier("ses", SESSION);
const J = encodeIdentifier("jti", seededUuid("token-j"));
const HSTS = "max-age=31536000; includeSubDomains";
const seconds = (instant: Date) => instant.getTime() / 1000;
const UNAUTHENTICATED = compact({
  error: "invalid_session",
  error_description: "A valid session is required.",
});

function expectExactJson(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("strict-transport-security")).toBe(HSTS);
}

describe("employee-sign-in", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  async function renew(iat: string, exp: string, instant: string): Promise<Response> {
    const token = await mintToken(harness.signingKey, {
      authTime: AUTH_TIME,
      iat: at(iat),
      exp: at(exp),
      sid: SID,
      jti: J,
    });
    harness.clock.setTo(at(instant));
    return harness.application.fetch(
      request("POST", "/api/authentication/session/renewal", {
        headers: { Origin: ORIGIN, Cookie: `__Host-session=${token}`, "Content-Length": "0" },
      }),
    );
  }

  function expectRenewedCookie(response: Response, iat: string, exp: string, maxAge: string): void {
    expect(response.status).toBe(204);
    expect(response.headers.get("strict-transport-security")).toBe(HSTS);
    const cookie = parseSetCookie(response.headers.get("set-cookie"));
    expect(cookie?.name).toBe("__Host-session");
    expect(Object.fromEntries(cookie?.attributes ?? [])).toEqual({
      httponly: true,
      secure: true,
      samesite: "Strict",
      path: "/",
      "max-age": maxAge,
    });
    const claims = decodePart(cookie?.value ?? "", 1);
    expect(claims).toMatchObject({
      sub: external("iac_alex"),
      sid: SID,
      auth_time: seconds(AUTH_TIME),
      iat: seconds(at(iat)),
      exp: seconds(at(exp)),
    });
    expect(claims.jti).toMatch(/^jti_[A-Za-z0-9_-]{22}$/);
    expect(claims.jti).not.toBe(J);
  }

  async function expectOneRenewalRecord(outcome: string, reasons: readonly string[]): Promise<void> {
    const records = await auditRecords(harness.owner);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action_key: "session.renew",
      actor_account_id: uuidOf("iac_alex"),
      audit_outcome: outcome,
      session_id: SESSION,
      reasons,
    });
  }

  test("scenario 04a ensures a renewal before half-life changes nothing", async () => {
    const response = await renew("14:50:00", "15:20:00", "15:00:00");
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await auditRecords(harness.owner)).toEqual([]);
  });

  test("scenario 04b ensures a renewal past half-life re-issues the token in the same session", async () => {
    const response = await renew("14:40:00", "15:10:00", "15:00:00");
    expectRenewedCookie(response, "15:00:00", "15:30:00", "1800");
    await expectOneRenewalRecord("Succeeded", []);
  });

  test("scenario 04c ensures a renewal is capped by the absolute lifetime", async () => {
    const response = await renew("15:20:00", "15:50:00", "15:40:00");
    expectRenewedCookie(response, "15:40:00", "16:00:00", "1200");
    await expectOneRenewalRecord("Succeeded", []);
  });

  test("scenario 04d requires the token not to end at the absolute lifetime for a renewal", async () => {
    const response = await renew("15:40:00", "16:00:00", "15:55:00");
    const body = compact({
      error: "absolute_lifetime_reached",
      error_description: "The session reached its maximum lifetime.",
    });
    expectExactJson(response, 403);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(await response.text()).toBe(body);
    await expectOneRenewalRecord("Failed", ["session.absolute-lifetime-reached"]);

    const token = await mintToken(harness.signingKey, {
      authTime: AUTH_TIME,
      iat: at("15:40:00"),
      exp: at("16:00:00"),
      sid: SID,
      jti: J,
    });
    harness.clock.setTo(at("15:59:30"));
    const stillValid = await harness.application.fetch(
      request("GET", "/api/authentication/session", { headers: { Cookie: `__Host-session=${token}` } }),
    );
    const principal = compact({
      account_id: external("iac_alex"),
      display_name: "Alex",
      department: "customer-support",
      job_function: "representative",
      job_level: 1,
      roles: ["support-case-handling"],
    });
    expectExactJson(stillValid, 200);
    expect(stillValid.headers.get("content-length")).toBe(String(principal.length));
    expect(await stillValid.text()).toBe(principal);
  });

  test("scenario 04e requires an unexpired token for a renewal", async () => {
    const response = await renew("15:40:00", "16:00:00", "16:00:01");
    expectExactJson(response, 401);
    expect(response.headers.get("content-length")).toBe(String(UNAUTHENTICATED.length));
    expect(await response.text()).toBe(UNAUTHENTICATED);
    expect(await auditRecords(harness.owner)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["Expired"]);
  });

  test("scenario 04f requires a valid principal for a renewal", async () => {
    await placeHold(harness.owner, "iac_alex", "OperationalSuspension", at("14:55:00"));
    const response = await renew("14:40:00", "15:10:00", "15:00:00");
    expectExactJson(response, 401);
    expect(response.headers.get("content-length")).toBe(String(UNAUTHENTICATED.length));
    expect(await response.text()).toBe(UNAUTHENTICATED);
    await expectOneRenewalRecord("Failed", ["account.operational-suspension", "session.principal-inactive"]);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeIdentifier } from "../../../../../kernel/identifier.ts";
import { seededUuid } from "../../../src/database/seed.ts";
import { specAuditRecords, validToken } from "../../support/explain-access.ts";
import {
  at,
  compact,
  createHarness,
  external,
  type Harness,
  insertCase,
  mintToken,
  ORIGIN,
  request,
  uuidOf,
} from "../../support/harness.ts";

const FORBIDDEN = compact({ error: "forbidden", error_description: "The request is not allowed." });
const INVALID_SESSION = compact({
  error: "invalid_session",
  error_description: "A valid session is required.",
});
const NOT_FOUND = compact({ error: "not_found", error_description: "The resource was not found." });

function upgrade(caseAlias: string, headers: Record<string, string>): Request {
  return request("GET", `/agents/case-agent/${encodeIdentifier("cse", seededUuid(caseAlias))}`, {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...headers,
    },
  });
}

async function expectJsonResponse(response: Response, status: number, body: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("content-length")).toBe(String(body.length));
  expect(await response.text()).toBe(body);
}

async function casesAndAssignments(harness: Harness) {
  return {
    cases: await harness.owner.query<Record<string, unknown>>(
      "SELECT case_id, subject_account_id, contact_account_id, closed_at FROM support_case",
    ),
    assignments: await harness.owner.query<Record<string, unknown>>(
      "SELECT case_id, assignee_account_id, assigned_by, assigned_at, ended_at FROM case_assignment",
    ),
  };
}

describe("explain-access opening a case", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  const openCase = async (headers: Record<string, string>) =>
    harness.application.fetch(
      request("POST", "/api/cases", {
        headers: { "Content-Type": "application/json", ...headers },
        body: "{}",
      }),
    );

  test("scenario 05a ensures opening a case assigns it to the opener", async () => {
    const response = await openCase({
      Origin: ORIGIN,
      Cookie: `__Host-session=${await validToken(harness, "iac_alex")}`,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    const text = await response.text();
    expect(response.headers.get("content-length")).toBe(String(text.length));
    const body = JSON.parse(text) as { case_id: string };
    expect(Object.keys(body)).toEqual(["case_id"]);
    expect(body.case_id).toMatch(/^cse_[A-Za-z0-9_-]{22}$/);
    expect(text.length).toBe(40);

    const { cases, assignments } = await casesAndAssignments(harness);
    expect(cases).toHaveLength(1);
    const caseId = cases[0]?.case_id;
    expect(encodeIdentifier("cse", caseId as never)).toBe(body.case_id);
    expect(cases[0]).toEqual({
      case_id: caseId,
      subject_account_id: null,
      contact_account_id: null,
      closed_at: null,
    });
    expect(assignments).toEqual([
      {
        case_id: caseId,
        assignee_account_id: uuidOf("iac_alex"),
        assigned_by: uuidOf("iac_alex"),
        assigned_at: at("15:00:00"),
        ended_at: null,
      },
    ]);
    const records = await specAuditRecords(harness);
    expect(
      records.map((record) => [record.action_key, record.actor, record.audit_outcome, record.case]),
    ).toEqual([
      ["case.open", "iac_alex", "Allow", caseId],
      ["case.open", "iac_alex", "Succeeded", caseId],
    ]);
  });

  test("scenario 05b requires case.open to open a case, refused without reason codes", async () => {
    const response = await openCase({
      Origin: ORIGIN,
      Cookie: `__Host-session=${await validToken(harness, "iac_drew")}`,
    });

    await expectJsonResponse(response, 403, FORBIDDEN);
    expect(await casesAndAssignments(harness)).toEqual({ cases: [], assignments: [] });
    const records = await specAuditRecords(harness);
    expect(
      records.map((record) => [record.action_key, record.actor, record.audit_outcome, record.reasons]),
    ).toEqual([["case.open", "iac_drew", "Deny", ["access.permission-not-held"]]]);
  });

  test("scenario 05c requires the application's origin to open a case", async () => {
    const response = await openCase({
      Origin: "https://attacker.example",
      Cookie: `__Host-session=${await validToken(harness, "iac_alex")}`,
    });

    await expectJsonResponse(response, 403, FORBIDDEN);
    expect(await casesAndAssignments(harness)).toEqual({ cases: [], assignments: [] });
    expect(await specAuditRecords(harness)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["ForeignOrigin"]);
  });

  test("scenario 05d requires a session to open a case", async () => {
    const response = await openCase({ Origin: ORIGIN });

    await expectJsonResponse(response, 401, INVALID_SESSION);
    expect(await casesAndAssignments(harness)).toEqual({ cases: [], assignments: [] });
    expect(await specAuditRecords(harness)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["NoSession"]);
  });
});

describe("explain-access connecting to a case", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  test.each([
    {
      letter: "A",
      name: "another representative's case",
      caseAlias: "cse_alex_1",
      principal: "iac_blair",
      cause: "CaseNotAssigned",
    },
    {
      letter: "B",
      name: "a supervisor who is not the assignee",
      caseAlias: "cse_alex_1",
      principal: "iac_sam",
      cause: "CaseNotAssigned",
    },
    {
      letter: "C",
      name: "a case that does not exist",
      caseAlias: "cse_missing",
      principal: "iac_blair",
      cause: "CaseNotFound",
    },
  ])(
    "scenario 05f ensures a case that is not the caller's, or does not exist, is not found — case $letter $name",
    async ({ caseAlias, principal, cause }) => {
      const response = await harness.application.fetch(
        upgrade(caseAlias, {
          Origin: ORIGIN,
          Cookie: `__Host-session=${await validToken(harness, principal)}`,
        }),
      );

      await expectJsonResponse(response, 404, NOT_FOUND);
      expect(harness.forwardedUpgrades).toEqual([]);
      expect(await specAuditRecords(harness)).toEqual([]);
      expect(harness.securityEvents.events.map((event) => event.cause)).toEqual([cause]);
    },
  );

  test("scenario 05g requires the application's origin on a connection", async () => {
    const response = await harness.application.fetch(
      upgrade("cse_alex_1", {
        Origin: "https://attacker.example",
        Cookie: `__Host-session=${await validToken(harness, "iac_alex")}`,
      }),
    );

    await expectJsonResponse(response, 403, FORBIDDEN);
    expect(harness.forwardedUpgrades).toEqual([]);
    expect(await specAuditRecords(harness)).toEqual([]);
    expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["ForeignOrigin"]);
  });

  test.each([
    { letter: "A", name: "no session", cookie: async () => undefined, cause: "NoSession" },
    {
      letter: "B",
      name: "expired session",
      cookie: async (harness: Harness) =>
        mintToken(harness.signingKey, {
          sub: external("iac_alex"),
          authTime: at("14:29:59"),
          iat: at("14:29:59"),
          exp: at("14:59:59"),
        }),
      cause: "Expired",
    },
  ])(
    "scenario 05h requires a valid session on a connection — case $letter $name",
    async ({ cookie, cause }) => {
      const token = await cookie(harness);
      const response = await harness.application.fetch(
        upgrade("cse_alex_1", {
          Origin: ORIGIN,
          ...(token === undefined ? {} : { Cookie: `__Host-session=${token}` }),
        }),
      );

      await expectJsonResponse(response, 401, INVALID_SESSION);
      expect(harness.forwardedUpgrades).toEqual([]);
      expect(await specAuditRecords(harness)).toEqual([]);
      expect(harness.securityEvents.events.map((event) => event.cause)).toEqual([cause]);
    },
  );
});

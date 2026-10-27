import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  accountIdOf,
  caseIdOf,
  casePath,
  caseRequest,
  caseState,
  givenCase,
  invalidRequest,
  lifecycleRecords,
  NOT_FOUND,
} from "../../support/case-lifecycle.ts";
import { validToken } from "../../support/explain-access.ts";
import {
  at,
  compact,
  createHarness,
  type Harness,
  insertCase,
  ORIGIN,
  request,
  uuidOf,
} from "../../support/harness.ts";

const SUMMARY = "Jane asked whether Acme Corp has SSO; it does, through the business plan.";

const stated = (records: Awaited<ReturnType<typeof lifecycleRecords>>) =>
  records.map(({ action_key, actor, subject, audit_outcome, reasons, case: caseAlias }) => ({
    action_key,
    actor,
    subject,
    audit_outcome,
    reasons,
    case: caseAlias,
  }));

describe("case-lifecycle closing a case", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  const close = (body: unknown) =>
    caseRequest(harness, "POST", casePath("cse_alex_1", "closure"), "iac_alex", body);

  test("scenario 34b ensures the CSR closes the case with a reviewed summary", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme", contact: "acc_jane" });

    const response = await close({ close_reason: "Resolved", summary: SUMMARY });

    expect(response.status).toBe(204);
    const { row, assignments } = await caseState(harness.owner, "cse_alex_1");
    expect(row).toMatchObject({
      closed_at: at("15:00:00"),
      closed_by: uuidOf("iac_alex"),
      close_reason: "Resolved",
      case_summary: SUMMARY,
    });
    expect(assignments).toEqual([
      {
        assignee_account_id: uuidOf("iac_alex"),
        ended_at: at("15:00:00"),
        ended_by: uuidOf("iac_alex"),
        end_reason: "CaseClosed",
      },
    ]);
    expect(harness.closedCaseConnections).toEqual([uuidOf("cse_alex_1")]);
    expect(stated(await lifecycleRecords(harness))).toEqual([
      {
        action_key: "case.close",
        actor: "iac_alex",
        subject: "acc_acme",
        audit_outcome: "Allow",
        reasons: [],
        case: "cse_alex_1",
      },
      {
        action_key: "case.close",
        actor: "iac_alex",
        subject: "acc_acme",
        audit_outcome: "Succeeded",
        reasons: [],
        case: "cse_alex_1",
      },
    ]);
  });

  describe("scenario 34c ensures a closed case is not found", () => {
    beforeEach(async () => {
      await givenCase(harness.owner, "cse_alex_1", {
        subject: "acc_acme",
        closed: { at: at("14:55:00"), by: "iac_alex", reason: "Resolved", summary: SUMMARY },
      });
    });

    test.each([
      { letter: "A", method: "GET" as const, action: "", body: undefined },
      {
        letter: "B",
        method: "PUT" as const,
        action: "contact",
        body: { account_id: accountIdOf("acc_jane") },
      },
      {
        letter: "C",
        method: "POST" as const,
        action: "closure",
        body: { close_reason: "Resolved", summary: "Again." },
      },
    ])("case $letter", async ({ method, action, body }) => {
      const before = await caseState(harness.owner, "cse_alex_1");

      const response = await caseRequest(harness, method, casePath("cse_alex_1", action), "iac_alex", body);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND);
      expect(await lifecycleRecords(harness)).toEqual([]);
      expect(await caseState(harness.owner, "cse_alex_1")).toEqual(before);
    });

    test("case D, a WebSocket upgrade", async () => {
      const response = await harness.application.fetch(
        request("GET", `/agents/case-agent/${caseIdOf("cse_alex_1")}`, {
          headers: {
            Origin: ORIGIN,
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            Cookie: `__Host-session=${await validToken(harness, "iac_alex")}`,
          },
        }),
      );

      expect(response.status).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND);
      expect(harness.forwardedUpgrades).toEqual([]);
    });
  });

  test.each([
    { letter: "A", body: { summary: "Done." }, field: "close_reason" },
    { letter: "B", body: { close_reason: "Settled", summary: "Done." }, field: "close_reason" },
    { letter: "C", body: { close_reason: "Resolved", summary: "" }, field: "summary" },
    { letter: "D", body: { close_reason: "Resolved", summary: "x".repeat(4001) }, field: "summary" },
  ])("scenario 34d ensures closing needs a reason and a summary — case $letter", async ({ body, field }) => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });

    const response = await close(body);

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      error: "invalid_request",
      error_details: [{ error: field }],
    });
    expect(await lifecycleRecords(harness)).toEqual([]);
    expect((await caseState(harness.owner, "cse_alex_1")).row?.closed_at).toBeNull();
  });
});

describe("case-lifecycle closing without reading the subject (D19)", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  test("scenario 34g ensures the assignee closes a case whose subject they may no longer read", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });
    await harness.owner.query(
      `UPDATE subscription_term SET plan_key = 'enterprise'
        WHERE ended_at IS NULL AND subscription_id IN (SELECT subscription_id FROM subscription WHERE account_id = $1)`,
      [uuidOf("acc_acme")],
    );

    const response = await caseRequest(harness, "POST", casePath("cse_alex_1", "closure"), "iac_alex", {
      close_reason: "Abandoned",
      summary: "Handed over: the account became Enterprise.",
    });

    expect(response.status).toBe(204);
    const { row, assignments } = await caseState(harness.owner, "cse_alex_1");
    expect(row).toMatchObject({
      close_reason: "Abandoned",
      case_summary: "Handed over: the account became Enterprise.",
    });
    expect(assignments).toEqual([
      expect.objectContaining({ ended_at: at("15:00:00"), end_reason: "CaseClosed" }),
    ]);
    expect(stated(await lifecycleRecords(harness))).toEqual([
      {
        action_key: "case.close",
        actor: "iac_alex",
        subject: "acc_acme",
        audit_outcome: "Allow",
        reasons: [],
        case: "cse_alex_1",
      },
      {
        action_key: "case.close",
        actor: "iac_alex",
        subject: "acc_acme",
        audit_outcome: "Succeeded",
        reasons: [],
        case: "cse_alex_1",
      },
    ]);
  });
});

describe("case-lifecycle past cases of an account", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    for (const [caseAlias, assignee] of [
      ["cse_alex_1", "iac_alex"],
      ["cse_blair_1", "iac_blair"],
      ["cse_alex_2", "iac_alex"],
      ["cse_blair_2", "iac_blair"],
      ["cse_blair_3", "iac_blair"],
    ] as const) {
      await insertCase(harness.owner, caseAlias, assignee, at("13:00:00"));
    }
    await givenCase(harness.owner, "cse_alex_1", {
      subject: "acc_acme",
      closed: { at: at("14:55:00"), by: "iac_alex", reason: "Resolved", summary: SUMMARY },
    });
    await givenCase(harness.owner, "cse_blair_1", {
      subject: "acc_acme",
      closed: { at: at("14:30:00"), by: "iac_blair", reason: "Abandoned", summary: "Caller hung up." },
    });
    await givenCase(harness.owner, "cse_alex_2", { subject: "acc_acme" });
    await givenCase(harness.owner, "cse_blair_2", {
      subject: "acc_initech",
      closed: { at: at("14:40:00"), by: "iac_blair", reason: "Resolved", summary: "Plan question." },
    });
    await givenCase(harness.owner, "cse_blair_3", {
      subject: "acc_umbrella",
      closed: { at: at("14:45:00"), by: "iac_blair", reason: "Resolved", summary: "Seats." },
    });
  });
  afterEach(async () => {
    await harness.close();
  });

  const pastCases = (query: string) => caseRequest(harness, "GET", `/api/cases?${query}`, "iac_alex");

  test("scenario 34e ensures the closed cases of an account show their summaries", async () => {
    const response = await pastCases(`subject=${accountIdOf("acc_acme")}&status=closed`);

    expect(response.status).toBe(200);
    const [alex] = await harness.owner.query<{ account_display_name: string }>(
      "SELECT account_display_name FROM account WHERE account_id = $1",
      [uuidOf("iac_alex")],
    );
    const [blair] = await harness.owner.query<{ account_display_name: string }>(
      "SELECT account_display_name FROM account WHERE account_id = $1",
      [uuidOf("iac_blair")],
    );
    const body = compact({
      cases: [
        {
          case_id: caseIdOf("cse_alex_1"),
          closed_at: "2026-10-22T14:55:00.000Z",
          closed_by: { account_id: accountIdOf("iac_alex"), display_name: alex?.account_display_name },
          close_reason: "Resolved",
          summary: SUMMARY,
        },
        {
          case_id: caseIdOf("cse_blair_1"),
          closed_at: "2026-10-22T14:30:00.000Z",
          closed_by: { account_id: accountIdOf("iac_blair"), display_name: blair?.account_display_name },
          close_reason: "Abandoned",
          summary: "Caller hung up.",
        },
      ],
    });
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(await response.text()).toBe(body);
    expect(
      (await lifecycleRecords(harness)).map((entry) => [
        entry.action_key,
        entry.actor,
        entry.subject,
        entry.audit_outcome,
        entry.detail.use_case,
      ]),
    ).toEqual([["account.read", "iac_alex", "acc_acme", "Allow", "ListClosedCases"]]);
  });

  test("scenario 34f ensures closed cases of an account the CSR may not read are refused as any read — case A", async () => {
    const response = await pastCases(`subject=${accountIdOf("acc_umbrella")}&status=closed`);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "access_denied",
      error_details: [{ error: "policy.enterprise-accounts-need-level-2" }],
    });
    expect(
      (await lifecycleRecords(harness)).map((entry) => [
        entry.subject,
        entry.audit_outcome,
        entry.detail.use_case,
      ]),
    ).toEqual([["acc_umbrella", "Deny", "ListClosedCases"]]);
  });

  test("scenario 34f ensures closed cases of an account the CSR may not read are refused as any read — case B", async () => {
    const response = await pastCases(`subject=${accountIdOf("acc_missing")}&status=closed`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_FOUND);
    expect(await lifecycleRecords(harness)).toEqual([]);
  });

  test("scenario 34f ensures closed cases of an account the CSR may not read are refused as any read — case C", async () => {
    const response = await pastCases(`subject=${accountIdOf("acc_acme")}`);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(invalidRequest("status", "Only status=closed is supported."));
    expect(await lifecycleRecords(harness)).toEqual([]);
  });
});

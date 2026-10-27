import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeIdentifier } from "../../../../../kernel/identifier.ts";
import { CASE_TOOLS } from "../../../src/agent/tools.ts";
import { seededUuid } from "../../../src/database/seed.ts";
import { caseIdOf, givenCase } from "../../support/case-lifecycle.ts";
import { validToken } from "../../support/explain-access.ts";
import {
  at,
  auditRecords,
  createHarness,
  external,
  type Harness,
  insertCase,
  ORIGIN,
  request,
  uuidOf,
} from "../../support/harness.ts";

/**
 * The guard of the rule `llm-never-authorizes` (AI_CONSTITUTION.md): every tool the model can call, and every route,
 * asks the decision point before it reads or changes data. Each runs as Drew, a finance analyst who holds none of
 * the support permissions, so every decision refuses: a tool or route that read data without asking would return
 * it. Each must answer a refusal that names no customer data, and leave a `Deny` record by Drew: the decision point
 * was asked. A tool or route this test does not list fails it.
 */

const DREW = "iac_drew";
const CASE = "cse_alex_1";
/** A second case of Drew's, without a subject: proposing one is the decision `propose_case_subject` makes. */
const CASE_WITHOUT_SUBJECT = "cse_alex_2";
const CASE_OF_TOOL: Readonly<Record<string, string>> = { propose_case_subject: CASE_WITHOUT_SUBJECT };

/** Tools that read and change nothing: exempt, with why. */
const EXEMPT_TOOLS: Readonly<Record<string, string>> = {
  draft_case_summary: "returns the text the model wrote; reads no data and stores nothing",
};

/** Valid arguments for each tool that reaches data. */
const TOOL_ARGUMENTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  find_customer_account: { query: "Initech" },
  check_entitlement: { account_id: external("acc_initech"), feature_key: "sso" },
  list_entitlements: { account_id: external("acc_initech") },
  explain_access: {
    person_email: "bob@initech.com",
    account_id: external("acc_initech"),
    feature_key: "sso",
    operation: "configure",
  },
  propose_case_subject: { account_id: external("acc_initech") },
  prepare_grant: { feature_key: "sso", duration_days: 7, reason: "A trial." },
  prepare_grant_revocation: {
    grant_id: encodeIdentifier("grt", seededUuid("grt_hooli_seats")),
    reason: "Done.",
  },
  prepare_grant_extension: {
    grant_id: encodeIdentifier("grt", seededUuid("grt_hooli_seats")),
    duration_days: 3,
    reason: "More.",
  },
};

/** Routes that decide nothing about customer data: exempt, with why. */
const EXEMPT_ROUTES: Readonly<Record<string, string>> = {
  "POST /api/authentication/sign-in": "establishes who the principal is; audited as session.sign-in",
  "POST /api/authentication/session/renewal": "acts on the caller's own session; audited",
  "GET /api/authentication/session": "returns the caller's own principal",
  "POST /api/authentication/sign-out": "ends the caller's own session; audited",
  "GET /agents/case-agent/{case_id}":
    "connects to the case's agent for its assignee; every tool it can call is covered here",
};

const CHANGE_REQUEST = seededUuid("chg_architecture");
const APPROVAL = seededUuid("apr_architecture");
const caseId = caseIdOf(CASE);
const changeRequestId = encodeIdentifier("chg", CHANGE_REQUEST);

/**
 * A request for each route that reaches data, as Drew would send it. `answers` 200 for a route that answers its own
 * view with what Drew may not read left out (the case: its accounts as ids, `readable: false`, case-lifecycle D14).
 */
const ROUTE_REQUESTS: Readonly<
  Record<string, { readonly path: string; readonly body?: unknown; readonly answers?: 200 }>
> = {
  "POST /api/cases": { path: "/api/cases", body: {} },
  "GET /api/cases": { path: `/api/cases?subject=${external("acc_initech")}&status=closed` },
  "GET /api/accounts": { path: "/api/accounts?query=Initech" },
  "GET /api/approvals": { path: "/api/approvals?status=Pending" },
  "GET /api/cases/{case_id}": { path: `/api/cases/${caseId}`, answers: 200 },
  "PUT /api/cases/{case_id}/subject": {
    path: `/api/cases/${caseId}/subject`,
    body: { account_id: external("acc_acme") },
  },
  "PUT /api/cases/{case_id}/contact": {
    path: `/api/cases/${caseId}/contact`,
    body: { account_id: external("acc_bob") },
  },
  "POST /api/cases/{case_id}/contact-authentication": {
    path: `/api/cases/${caseId}/contact-authentication`,
    body: { kind: "Knowledge", method: "SecurityQuestion", passed: true },
  },
  "POST /api/cases/{case_id}/closure": {
    path: `/api/cases/${caseId}/closure`,
    body: { close_reason: "Resolved", summary: "Done." },
  },
  "GET /api/cases/{case_id}/change-requests/{change_request_id}": {
    path: `/api/cases/${caseId}/change-requests/${changeRequestId}`,
  },
  "POST /api/cases/{case_id}/change-requests/{change_request_id}/confirmation": {
    path: `/api/cases/${caseId}/change-requests/${changeRequestId}/confirmation`,
    body: {},
  },
  "POST /api/cases/{case_id}/change-requests/{change_request_id}/cancellation": {
    path: `/api/cases/${caseId}/change-requests/${changeRequestId}/cancellation`,
    body: {},
  },
  "POST /api/approvals/{approval_id}/decision": {
    path: `/api/approvals/${encodeIdentifier("apr", APPROVAL)}/decision`,
    body: { decision: "Approved" },
  },
};

describe("architecture: llm-never-authorizes", () => {
  let harness: Harness;
  let customerData: readonly string[];

  beforeEach(async () => {
    harness = await createHarness();
    // A case assigned to Drew, with a subject and a contact, holding a change request and its pending approval.
    await insertCase(harness.owner, CASE, DREW, at("14:00:00"));
    await givenCase(harness.owner, CASE, { subject: "acc_initech", contact: "acc_bob" });
    await insertCase(harness.owner, CASE_WITHOUT_SUBJECT, DREW, at("14:05:00"));
    await harness.owner.query(
      `INSERT INTO change_request (change_request_id, case_id, subject_account_id, change_kind, parameters,
                                   entitlement_diff, subject_account_version, preview_outcome, change_status,
                                   requested_by, requested_at)
       VALUES ($1, $2, $3, 'CreateGrant', '{"feature_key":"sso","duration_days":30,"reason":"x"}', '[]', 0,
               'Conditional', 'AwaitingApproval', $4, $5)`,
      [CHANGE_REQUEST, seededUuid(CASE), uuidOf("acc_initech"), uuidOf("iac_alex"), at("14:30:00")],
    );
    await harness.owner.query(
      `INSERT INTO change_approval (approval_id, change_request_id, approval_status, requested_at, expires_at)
       VALUES ($1, $2, 'Pending', $3, $4)`,
      [APPROVAL, CHANGE_REQUEST, at("14:30:00"), new Date("2026-10-25T14:30:00Z")],
    );
    // What must never reach Drew: every customer account's name, and every person's email.
    const names = await harness.owner.query<{ name: string }>(
      `SELECT a.account_display_name AS name FROM customer_account c JOIN account a USING (account_id)
       UNION SELECT email AS name FROM individual WHERE email IS NOT NULL`,
    );
    customerData = names.map((row) => row.name.toLowerCase());
  });
  afterEach(async () => {
    await harness.close();
  });

  const denialsByDrew = async () =>
    (await auditRecords(harness.owner)).filter(
      (record) => record.actor_account_id === uuidOf(DREW) && record.audit_outcome === "Deny",
    ).length;
  const leaked = (text: string) => customerData.filter((name) => text.toLowerCase().includes(name));

  test("ensures every tool is either covered or exempt, with a reason", () => {
    expect(Object.keys(CASE_TOOLS).sort()).toEqual(
      [...Object.keys(TOOL_ARGUMENTS), ...Object.keys(EXEMPT_TOOLS)].sort(),
    );
  });

  test.each(Object.entries(TOOL_ARGUMENTS))(
    "ensures the tool %s asks the decision point before it reads, and reveals nothing when refused",
    async (toolName, toolArguments) => {
      const before = await denialsByDrew();

      const outcome = await CASE_TOOLS[toolName]?.run(toolArguments, {
        request: {
          principalAccountId: uuidOf(DREW),
          sessionId: null,
          caseId: seededUuid(CASE_OF_TOOL[toolName] ?? CASE),
          toolCallId: "call_architecture",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        },
        runUseCases: (work) => harness.application.withUseCases(work),
        describeReason: (code) => code,
      });

      expect(leaked(JSON.stringify(outcome))).toEqual([]);
      expect(await denialsByDrew()).toBeGreaterThan(before);
    },
  );

  test("ensures every route is either covered or exempt, with a reason", () => {
    expect(harness.application.routeKeys()).toEqual(
      [...Object.keys(ROUTE_REQUESTS), ...Object.keys(EXEMPT_ROUTES)].sort(),
    );
  });

  test.each(Object.entries(ROUTE_REQUESTS))(
    "ensures the route %s asks the decision point before it reads, and reveals nothing when refused",
    async (route, { path, body, answers }) => {
      const method = route.split(" ")[0] ?? "GET";
      const before = await denialsByDrew();

      const response = await harness.application.fetch(
        request(method, path, {
          headers: {
            Origin: ORIGIN,
            Cookie: `__Host-session=${await validToken(harness, DREW)}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );

      if (answers === 200) expect(response.status).toBe(200);
      else expect(response.status).toBeGreaterThanOrEqual(400);
      expect(leaked(await response.text())).toEqual([]);
      expect(await denialsByDrew()).toBeGreaterThan(before);
    },
  );
});

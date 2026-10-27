import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  accountIdOf,
  casePath,
  caseRequest,
  caseState,
  conflict,
  FORBIDDEN,
  givenCase,
  INVALID_SESSION,
  lifecycleRecords,
  NOT_FOUND,
} from "../../support/case-lifecycle.ts";
import {
  at,
  compact,
  createHarness,
  type Harness,
  insertCase,
  placeHold,
  uuidOf,
} from "../../support/harness.ts";

const ACCESS_DENIED_ENTERPRISE = compact({
  error: "access_denied",
  error_description: "The request was denied by policy.",
  error_details: [
    {
      error: "policy.enterprise-accounts-need-level-2",
      error_description: "Enterprise accounts need job level 2 or a supervisor.",
    },
  ],
});

/** The fields of an audit record the case-lifecycle spec states. */
const stated = (records: Awaited<ReturnType<typeof lifecycleRecords>>) =>
  records.map(({ action_key, actor, subject, audit_outcome, reasons, case: caseAlias }) => ({
    action_key,
    actor,
    subject,
    audit_outcome,
    reasons,
    case: caseAlias,
  }));

describe("case-lifecycle setting the subject", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  const setSubject = (account: string, principal = "iac_alex") =>
    caseRequest(harness, "PUT", casePath("cse_alex_1", "subject"), principal, {
      account_id: accountIdOf(account),
    });

  test("scenario 33b ensures the CSR sets the subject", async () => {
    const response = await setSubject("acc_acme");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect((await caseState(harness.owner, "cse_alex_1")).row?.subject_account_id).toBe(uuidOf("acc_acme"));
    expect(stated(await lifecycleRecords(harness))).toEqual([
      {
        action_key: "case.set-subject",
        actor: "iac_alex",
        subject: "acc_acme",
        audit_outcome: "Allow",
        reasons: [],
        case: "cse_alex_1",
      },
      {
        action_key: "case.set-subject",
        actor: "iac_alex",
        subject: "acc_acme",
        audit_outcome: "Succeeded",
        reasons: [],
        case: "cse_alex_1",
      },
    ]);
    const read = await caseRequest(harness, "GET", casePath("cse_alex_1"), "iac_alex");
    expect(((await read.json()) as { subject: unknown }).subject).toEqual({
      account_id: accountIdOf("acc_acme"),
      readable: true,
      display_name: "Acme Corp",
      holds: [],
    });
  });

  test("scenario 33c ensures the subject is set once", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });

    const response = await setSubject("acc_initech");

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(conflict("subject_already_set", "The case's subject is already set."));
    expect((await caseState(harness.owner, "cse_alex_1")).row?.subject_account_id).toBe(uuidOf("acc_acme"));
    expect(stated(await lifecycleRecords(harness))).toEqual([
      {
        action_key: "case.set-subject",
        actor: "iac_alex",
        subject: "acc_initech",
        audit_outcome: "Allow",
        reasons: [],
        case: "cse_alex_1",
      },
      {
        action_key: "case.set-subject",
        actor: "iac_alex",
        subject: "acc_initech",
        audit_outcome: "Failed",
        reasons: ["support.subject-already-set"],
        case: "cse_alex_1",
      },
    ]);
  });

  test("scenario 33d ensures a subject the CSR may not read is refused as any read — case A stopped by a policy", async () => {
    const response = await setSubject("acc_umbrella");

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(ACCESS_DENIED_ENTERPRISE);
    expect((await caseState(harness.owner, "cse_alex_1")).row?.subject_account_id).toBeNull();
    expect(stated(await lifecycleRecords(harness))).toEqual([
      {
        action_key: "case.set-subject",
        actor: "iac_alex",
        subject: "acc_umbrella",
        audit_outcome: "Deny",
        reasons: ["policy.enterprise-accounts-need-level-2"],
        case: "cse_alex_1",
      },
    ]);
  });

  test("scenario 33d ensures a subject the CSR may not read is refused as any read — case B an account that does not exist", async () => {
    const response = await setSubject("acc_missing");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_FOUND);
    expect((await caseState(harness.owner, "cse_alex_1")).row?.subject_account_id).toBeNull();
    expect(await lifecycleRecords(harness)).toEqual([]);
  });

  test.each([
    { letter: "A", method: "GET" as const, action: "", body: undefined },
    { letter: "B", method: "PUT" as const, action: "subject", body: { account_id: accountIdOf("acc_acme") } },
    { letter: "C", method: "PUT" as const, action: "contact", body: { account_id: accountIdOf("acc_jane") } },
    {
      letter: "D",
      method: "POST" as const,
      action: "contact-authentication",
      body: { kind: "Knowledge", method: "SecurityQuestion", passed: true },
    },
    {
      letter: "E",
      method: "POST" as const,
      action: "closure",
      body: { close_reason: "Resolved", summary: "Done." },
    },
  ])(
    "scenario 33e ensures only the assignee acts in a case — case $letter",
    async ({ method, action, body }) => {
      await givenCase(harness.owner, "cse_alex_1", { contact: "acc_jane" });
      const before = await caseState(harness.owner, "cse_alex_1");

      const response = await caseRequest(harness, method, casePath("cse_alex_1", action), "iac_blair", body);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND);
      expect(harness.securityEvents.events.map((event) => event.cause)).toEqual(["CaseNotAssigned"]);
      expect(await lifecycleRecords(harness)).toEqual([]);
      expect(await caseState(harness.owner, "cse_alex_1")).toEqual(before);
    },
  );

  test.each([
    { letter: "A", method: "GET" as const, action: "", body: undefined },
    { letter: "B", method: "PUT" as const, action: "subject", body: { account_id: accountIdOf("acc_acme") } },
    { letter: "C", method: "PUT" as const, action: "contact", body: { account_id: accountIdOf("acc_jane") } },
    {
      letter: "D",
      method: "POST" as const,
      action: "contact-authentication",
      body: { kind: "Knowledge", method: "SecurityQuestion", passed: true },
    },
    {
      letter: "E",
      method: "POST" as const,
      action: "closure",
      body: { close_reason: "Resolved", summary: "Done." },
    },
  ])(
    "scenario 33g ensures a CSR suspended after opening the case is signed out — case $letter",
    async ({ method, action, body }) => {
      await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });
      await placeHold(harness.owner, "iac_alex", "OperationalSuspension", at("14:55:00"));
      const before = await caseState(harness.owner, "cse_alex_1");

      const response = await caseRequest(harness, method, casePath("cse_alex_1", action), "iac_alex", body);

      expect(response.status).toBe(401);
      expect(await response.text()).toBe(INVALID_SESSION);
      expect(await lifecycleRecords(harness)).toEqual([]);
      expect(await caseState(harness.owner, "cse_alex_1")).toEqual(before);
    },
  );

  describe("scenario 33h ensures a CSR whose role was removed is refused", () => {
    beforeEach(async () => {
      // A transfer to finance ends the birthright role support-case-handling: no case.open, no account.read.
      await harness.owner.query(
        "UPDATE employee SET department_key = 'finance', job_function_key = 'analyst' WHERE internal_identity_id = $1",
        [uuidOf("emp_alex")],
      );
    });

    test("case A, an action on a subject account", async () => {
      const response = await setSubject("acc_acme");

      expect(response.status).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND);
      expect(stated(await lifecycleRecords(harness))).toEqual([
        {
          action_key: "case.set-subject",
          actor: "iac_alex",
          subject: "acc_acme",
          audit_outcome: "Deny",
          reasons: ["access.permission-not-held"],
          case: "cse_alex_1",
        },
      ]);
    });

    test("case B, an action with no subject account", async () => {
      const response = await caseRequest(harness, "POST", casePath("cse_alex_1", "closure"), "iac_alex", {
        close_reason: "Abandoned",
        summary: "Caller hung up.",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toBe(FORBIDDEN);
      expect((await caseState(harness.owner, "cse_alex_1")).row?.closed_at).toBeNull();
      expect(stated(await lifecycleRecords(harness))).toEqual([
        {
          action_key: "case.close",
          actor: "iac_alex",
          subject: null,
          audit_outcome: "Deny",
          reasons: ["access.permission-not-held"],
          case: "cse_alex_1",
        },
      ]);
    });
  });

  test("scenario 33i ensures two subjects set at once: exactly one wins", async () => {
    const [first, second] = await Promise.all([setSubject("acc_acme"), setSubject("acc_initech")]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([204, 409]);
    const winner = first.status === 204 ? "acc_acme" : "acc_initech";
    const loser = winner === "acc_acme" ? "acc_initech" : "acc_acme";
    expect((await caseState(harness.owner, "cse_alex_1")).row?.subject_account_id).toBe(uuidOf(winner));
    const records = stated(await lifecycleRecords(harness));
    expect(
      records.filter((record) => record.subject === winner).map((record) => record.audit_outcome),
    ).toEqual(["Allow", "Succeeded"]);
    expect(records.filter((record) => record.subject === loser)).toEqual([
      expect.objectContaining({ audit_outcome: "Allow" }),
      expect.objectContaining({ audit_outcome: "Failed", reasons: ["support.subject-already-set"] }),
    ]);
  });

  test.each([
    {
      letter: "A",
      account: "acc_initech",
      hold: true,
      subject: { display_name: "Initech", holds: ["account.operational-suspension"] },
    },
    { letter: "B", account: "acc_jane", hold: false, subject: { display_name: "Jane Doe", holds: [] } },
  ])(
    "scenario 33j ensures a subject on hold, or a person's own account, can be the subject — case $letter",
    async ({ account, hold, subject }) => {
      if (hold) await placeHold(harness.owner, account, "OperationalSuspension", at("14:00:00"));

      const response = await setSubject(account);

      expect(response.status).toBe(204);
      expect(stated(await lifecycleRecords(harness)).map((record) => record.audit_outcome)).toEqual([
        "Allow",
        "Succeeded",
      ]);
      const read = await caseRequest(harness, "GET", casePath("cse_alex_1"), "iac_alex");
      expect(((await read.json()) as { subject: unknown }).subject).toEqual({
        account_id: accountIdOf(account),
        readable: true,
        ...subject,
      });
    },
  );
});

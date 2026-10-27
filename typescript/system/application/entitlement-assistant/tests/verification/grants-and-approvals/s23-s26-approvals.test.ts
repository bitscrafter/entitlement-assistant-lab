import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { decodeIdentifier, type Uuid } from "../../../../../kernel/identifier.ts";
import { casePath, caseRequest } from "../../support/case-lifecycle.ts";
import {
  approvalRow,
  approvals,
  changeAction,
  changeRequestRow,
  decide,
  givenGrantCase,
  grantsOf,
  outboxMessages,
  prepare,
  preparedId,
} from "../../support/grants.ts";
import { at, createHarness, type Harness, uuidOf } from "../../support/harness.ts";

const THIRTY_DAYS = {
  kind: "CreateGrant",
  featureKey: "audit-log-export",
  durationDays: 30,
  reason: "A month of exports for an audit.",
} as const;

const approvalUuid = (approvalId: string): Uuid => {
  const decoded = decodeIdentifier("apr", approvalId);
  if (!decoded.ok) throw new Error(`not an approval id: ${approvalId}`);
  return decoded.value;
};

describe("grants-and-approvals approvals", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Prepares and confirms the 30-day grant as `principal`: the approval's external id and the request's. */
  const awaitingApproval = async (principal = "iac_alex") => {
    const prepared = await prepare(harness, principal, THIRTY_DAYS);
    expect(prepared).toMatchObject({ changeRequest: { preview: { outcome: "Conditional" } } });
    const changeRequestId = preparedId(prepared);
    const response = await changeAction(harness, principal, changeRequestId, "confirmation");
    expect(response.status).toBe(202);
    const body = (await response.json()) as { status: string; approval_id: string };
    expect(body.status).toBe("AwaitingApproval");
    return { approvalId: body.approval_id, changeRequestId };
  };

  test("scenario 23a ensures over 14 days waits for a supervisor — case A", async () => {
    await givenGrantCase(harness);

    const { approvalId, changeRequestId } = await awaitingApproval();

    expect(await approvalRow(harness.owner, approvalId)).toMatchObject({
      approval_status: "Pending",
      expires_at: new Date("2026-10-25T15:00:00Z"),
    });
    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "AwaitingApproval",
    });
    expect(harness.approvalProcess.started).toEqual([
      { approvalId: approvalUuid(approvalId), expiresAt: new Date("2026-10-25T15:00:00Z") },
    ]);
    expect(
      (await outboxMessages(harness.owner)).map((message) => [
        message.message_type,
        message.delivered_at !== null,
      ]),
    ).toEqual([["start", true]]);
  });

  test("scenario 23a ensures a lost start is repaired by the sweep, once — case B", async () => {
    await givenGrantCase(harness);
    harness.approvalProcess.failStarts = true;

    const { approvalId } = await awaitingApproval();
    harness.approvalProcess.failStarts = false;
    expect(harness.approvalProcess.started).toEqual([]);
    harness.clock.setTo(at("15:02:00"));
    await harness.application.sweep();
    await harness.application.sweep();

    expect(harness.approvalProcess.started.map((started) => started.approvalId)).toEqual([
      approvalUuid(approvalId),
    ]);
    expect((await outboxMessages(harness.owner)).every((message) => message.delivered_at !== null)).toBe(
      true,
    );
  });

  test("scenario 24a ensures an approval by another supervisor is applied by the system", async () => {
    await givenGrantCase(harness);
    const { approvalId, changeRequestId } = await awaitingApproval();
    harness.clock.setTo(at("16:00:00"));

    const response = await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approval_status: "Approved" });
    expect(harness.approvalProcess.decisions).toEqual([approvalUuid(approvalId)]);
    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Applied",
      applied_by: uuidOf("iac_sys_approval_process"),
    });
    const [grant] = await grantsOf(harness.owner, "acc_initech");
    expect(grant).toMatchObject({ starts_at: at("16:00:00"), expires_at: new Date("2026-11-21T16:00:00Z") });
  });

  test("scenario 24a and 21a ensure the case hears every outcome as a case event (D15)", async () => {
    await givenGrantCase(harness);
    const applied = preparedId(
      await prepare(harness, "iac_alex", {
        kind: "CreateGrant",
        featureKey: "seats",
        quota: 5,
        durationDays: 7,
        reason: "A week.",
      }),
    );
    expect((await changeAction(harness, "iac_alex", applied, "confirmation")).status).toBe(200);
    const { approvalId } = await awaitingApproval();
    harness.clock.setTo(at("16:00:00"));
    await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

    const events = await harness.application
      .caseAgentParts(uuidOf("cse_alex_1"), { rateLimiter: harness.searchRateLimiter })
      .caseEvents();

    expect(
      events
        .map((event) => event.text)
        .filter((text) => !text.startsWith("Subject") && !text.startsWith("Contact")),
    ).toEqual([
      "Grant prepared: seats +5, 7 days (Alex, at 15:00).",
      "Grant confirmed and applied: seats +5 until 2026-10-29 (Alex, at 15:00).",
      "Grant prepared: audit log export, 30 days (Alex, at 15:00).",
      "Awaiting approval: audit log export, 30 days (Alex, at 15:00).",
      "Approved by Morgan (at 16:00).",
      "Grant applied after approval: audit log export until 2026-11-21 (approval-process, at 16:00).",
    ]);
    expect(harness.deliveredCaseEvents.length).toBeGreaterThanOrEqual(3);
  });

  test("scenario 24b ensures a denial with a reason refuses the change", async () => {
    await givenGrantCase(harness);
    const { approvalId, changeRequestId } = await awaitingApproval();

    const missingReason = await decide(harness, "iac_morgan", approvalId, { decision: "Denied" });
    const otherWithoutComment = await decide(harness, "iac_morgan", approvalId, {
      decision: "Denied",
      decision_reason: "Other",
    });
    const denied = await decide(harness, "iac_morgan", approvalId, {
      decision: "Denied",
      decision_reason: "PolicyLimit",
    });
    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

    expect(missingReason.status).toBe(400);
    expect(JSON.stringify(await missingReason.json())).toContain("decision_reason");
    expect(otherWithoutComment.status).toBe(400);
    expect(JSON.stringify(await otherWithoutComment.json())).toContain("decision_comment");
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({ approval_status: "Denied" });
    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Refused",
      status_reason: "support.approval-denied",
    });
    expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
  });

  test("scenario 24c ensures an approved change on a changed subject is canceled as stale", async () => {
    await givenGrantCase(harness);
    const { approvalId, changeRequestId } = await awaitingApproval();
    await harness.owner.query("UPDATE account SET version = version + 1 WHERE account_id = $1", [
      uuidOf("acc_initech"),
    ]);

    await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Canceled",
      status_reason: "support.stale-change-request",
    });
    expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
  });

  test("scenario 24d ensures an approved change is refused when the confirmer lost the permission", async () => {
    await givenGrantCase(harness);
    const { approvalId, changeRequestId } = await awaitingApproval();
    await harness.owner.query(
      "UPDATE employee SET department_key = 'finance', job_function_key = 'analyst' WHERE internal_identity_id = $1",
      [uuidOf("emp_alex")],
    );

    await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Refused",
    });
    expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
  });

  test("scenario 24e ensures an approval after the contact's authentication expired is applied", async () => {
    await givenGrantCase(harness);
    const { approvalId, changeRequestId } = await awaitingApproval();
    harness.clock.setTo(at("16:00:00"));

    await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Applied",
      contact_authenticated_at: at("14:55:00"),
    });
  });

  test("scenario 25a ensures nobody approves what they requested or confirmed", async () => {
    await givenGrantCase(harness, { assignee: "iac_sam" });
    const { approvalId } = await awaitingApproval("iac_sam");

    const own = await decide(harness, "iac_sam", approvalId, { decision: "Approved" });
    const other = await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });

    expect(own.status).toBe(403);
    expect(JSON.stringify(await own.json())).toContain("policy.no-self-approval");
    expect(other.status).toBe(200);
  });

  test("scenario 25b ensures only supervisors see and decide approvals", async () => {
    await givenGrantCase(harness);
    const { approvalId } = await awaitingApproval();

    const repList = await approvals(harness, "iac_alex");
    const repDecision = await decide(harness, "iac_alex", approvalId, { decision: "Approved" });
    const supervisorList = await approvals(harness, "iac_morgan");

    expect(repList.status).toBe(403);
    expect(repDecision.status).toBe(404);
    expect(supervisorList.status).toBe(200);
    const listed = (await supervisorList.json()) as { approvals: { approval_id: string }[] };
    expect(listed.approvals.map((approval) => approval.approval_id)).toEqual([approvalId]);
  });

  test("scenario 26a ensures an approval not decided in 72 hours expires", async () => {
    await givenGrantCase(harness);
    const { approvalId, changeRequestId } = await awaitingApproval();
    harness.clock.setTo(new Date("2026-10-25T15:00:00Z"));

    await harness.application.approvalProcessWoke(approvalUuid(approvalId), "deadline");

    expect(await approvalRow(harness.owner, approvalId)).toMatchObject({ approval_status: "Expired" });
    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Expired",
      status_reason: "support.approval-expired",
    });
    expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
  });

  describe("scenario 26b ensures a late or second decision is refused", () => {
    test("case A, after the deadline", async () => {
      await givenGrantCase(harness);
      const { approvalId } = await awaitingApproval();
      harness.clock.setTo(new Date("2026-10-25T15:00:01Z"));

      const response = await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });

      expect(response.status).toBe(409);
      expect(JSON.stringify(await response.json())).toContain("approval_not_pending");
    });

    test("case B, twice", async () => {
      await givenGrantCase(harness);
      const { approvalId } = await awaitingApproval();

      await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
      const second = await decide(harness, "iac_morgan", approvalId, {
        decision: "Denied",
        decision_reason: "Other",
        decision_comment: "Changed my mind.",
      });

      expect(second.status).toBe(409);
      expect(JSON.stringify(await second.json())).toContain("approval_not_pending");
    });

    test("case C, a decision racing the deadline: exactly one wins", async () => {
      await givenGrantCase(harness);
      const { approvalId, changeRequestId } = await awaitingApproval();
      harness.clock.setTo(new Date("2026-10-25T15:00:00Z"));

      await Promise.all([
        decide(harness, "iac_morgan", approvalId, { decision: "Approved" }),
        harness.application.approvalProcessWoke(approvalUuid(approvalId), "deadline"),
      ]);

      const status = (await approvalRow(harness.owner, approvalId))?.approval_status;
      expect(["Approved", "Expired"]).toContain(status);
      const request = await changeRequestRow(harness.owner, changeRequestId);
      expect(request?.change_status).toBe(status === "Expired" ? "Expired" : "AwaitingApproval");
    });
  });

  describe("review round 1", () => {
    test("R1-1 ensures a decision made in time but delivered after the deadline wake is applied", async () => {
      await givenGrantCase(harness);
      const { approvalId, changeRequestId } = await awaitingApproval();
      harness.clock.setTo(new Date("2026-10-25T14:59:59Z"));
      expect((await decide(harness, "iac_morgan", approvalId, { decision: "Approved" })).status).toBe(200);
      harness.clock.setTo(new Date("2026-10-25T15:00:00Z"));

      await harness.application.approvalProcessWoke(approvalUuid(approvalId), "deadline");

      expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
        change_status: "Applied",
      });
    });

    test("R1-1 ensures the sweep applies an approved change whose process never woke", async () => {
      await givenGrantCase(harness);
      const { approvalId, changeRequestId } = await awaitingApproval();
      await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });
      harness.clock.setTo(at("15:02:00"));

      await harness.application.sweep();

      expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
        change_status: "Applied",
      });
    });

    test("R1-2 ensures a wake before the deadline expires nothing", async () => {
      await givenGrantCase(harness);
      const { approvalId } = await awaitingApproval();
      harness.clock.setTo(at("16:00:00"));

      await harness.application.approvalProcessWoke(approvalUuid(approvalId), "deadline");

      expect(await approvalRow(harness.owner, approvalId)).toMatchObject({ approval_status: "Pending" });
    });

    test("R1-3 ensures closing the case while a supervisor decides never fails", async () => {
      await givenGrantCase(harness);
      const { approvalId } = await awaitingApproval();

      const [closed, decided] = await Promise.all([
        caseRequest(harness, "POST", casePath("cse_alex_1", "closure"), "iac_alex", {
          close_reason: "Abandoned",
          summary: "The customer withdrew.",
        }),
        decide(harness, "iac_morgan", approvalId, { decision: "Approved" }),
      ]);

      expect(closed.status).toBe(204);
      expect([200, 409]).toContain(decided.status);
    });

    test("R2-2 ensures closing the case keeps a supervisor's approval, which is then applied", async () => {
      await givenGrantCase(harness);
      const { approvalId, changeRequestId } = await awaitingApproval();
      await decide(harness, "iac_morgan", approvalId, { decision: "Approved" });

      const closed = await caseRequest(harness, "POST", casePath("cse_alex_1", "closure"), "iac_alex", {
        close_reason: "Resolved",
        summary: "Approved and done.",
      });
      await harness.application.approvalProcessWoke(approvalUuid(approvalId), "decision");

      expect(closed.status).toBe(204);
      expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
        change_status: "Applied",
      });
    });

    test("R1-5 ensures an approver who may not read the account neither sees nor decides its approval", async () => {
      await givenGrantCase(harness);
      const { approvalId } = await awaitingApproval();
      await harness.owner.query(
        `INSERT INTO internal_role_assignment (assignment_id, internal_account_id, role_key, principal_kind, reason,
                                               assigned_at, assigned_by)
         VALUES (gen_random_uuid(), $1, 'approval-decision', 'Employee', 'Test', $2, $1)`,
        [uuidOf("iac_drew"), at("14:00:00")],
      );

      const listed = (await (await approvals(harness, "iac_drew")).json()) as { approvals: unknown[] };
      const decided = await decide(harness, "iac_drew", approvalId, { decision: "Approved" });

      expect(listed.approvals).toEqual([]);
      expect(decided.status).toBe(404);
    });
  });

  test("scenario 15b ensures closing the case cancels what is pending", async () => {
    await givenGrantCase(harness);
    const prepared = preparedId(
      await prepare(harness, "iac_alex", { ...THIRTY_DAYS, durationDays: 3, reason: "A short trial." }),
    );
    const { approvalId, changeRequestId } = await awaitingApproval();

    const closed = await caseRequest(harness, "POST", casePath("cse_alex_1", "closure"), "iac_alex", {
      close_reason: "Abandoned",
      summary: "The customer withdrew.",
    });

    expect(closed.status).toBe(204);
    expect(await changeRequestRow(harness.owner, prepared)).toMatchObject({ change_status: "Canceled" });
    expect(await changeRequestRow(harness.owner, changeRequestId)).toMatchObject({
      change_status: "Canceled",
    });
    expect(await approvalRow(harness.owner, approvalId)).toMatchObject({ approval_status: "Canceled" });
    expect(harness.approvalProcess.terminated).toEqual([approvalUuid(approvalId)]);
    expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
  });
});

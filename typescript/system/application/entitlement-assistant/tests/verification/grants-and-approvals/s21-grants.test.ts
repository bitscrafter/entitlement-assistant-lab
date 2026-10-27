import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { casePath, caseRequest } from "../../support/case-lifecycle.ts";
import {
  changeAction,
  changeRequestRow,
  entitled,
  givenGrantCase,
  grantsOf,
  prepare,
  preparedId,
} from "../../support/grants.ts";
import { at, createHarness, type Harness, placeHold, uuidOf } from "../../support/harness.ts";

const SEVEN_DAYS = {
  kind: "CreateGrant",
  featureKey: "audit-log-export",
  durationDays: 7,
  reason: "Evaluating exports.",
} as const;

describe("grants-and-approvals grants within the limits", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test("scenario 21a ensures a grant within 14 days, asked by an authenticated owner, is applied", async () => {
    await givenGrantCase(harness);

    const prepared = await prepare(harness, "iac_alex", SEVEN_DAYS);
    expect(prepared).toMatchObject({
      kind: "Prepared",
      changeRequest: {
        kind: "CreateGrant",
        status: "AwaitingConfirmation",
        preview: { outcome: "Allow", reasonCodes: [] },
      },
    });
    const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "Applied" });
    const [grant] = await grantsOf(harness.owner, "acc_initech");
    expect(grant).toMatchObject({
      feature_key: "audit-log-export",
      starts_at: at("15:00:00"),
      expires_at: new Date("2026-10-29T15:00:00Z"),
      ended_at: null,
    });
    expect(await changeRequestRow(harness.owner, preparedId(prepared))).toMatchObject({
      change_status: "Applied",
      contact_account_id: uuidOf("acc_bob"),
      requested_by: uuidOf("iac_alex"),
      confirmed_by: uuidOf("iac_alex"),
      applied_by: uuidOf("iac_alex"),
    });
    expect(await entitled(harness, "acc_initech", "audit-log-export")).toMatchObject({ kind: "Entitled" });
  });

  test("scenario 21b ensures a grant on the CSR's own initiative, a metered quota", async () => {
    await givenGrantCase(harness, { assignee: "iac_blair", contact: null });

    const prepared = await prepare(harness, "iac_blair", {
      kind: "CreateGrant",
      featureKey: "seats",
      quota: 10,
      durationDays: 5,
      reason: "Goodwill during an outage.",
    });
    const response = await changeAction(harness, "iac_blair", preparedId(prepared), "confirmation");

    expect(response.status).toBe(200);
    expect(await changeRequestRow(harness.owner, preparedId(prepared))).toMatchObject({
      contact_account_id: null,
    });
    expect(await entitled(harness, "acc_initech", "seats")).toMatchObject({ kind: "Entitled", quota: 13 });
  });

  describe("scenario 21c ensures grants that are refused", () => {
    const refusedAtBoth = async (
      principal: string,
      change: Parameters<typeof prepare>[2],
      reasons: string[],
    ) => {
      const prepared = await prepare(harness, principal, change);
      expect(prepared).toMatchObject({ kind: "Prepared", changeRequest: { preview: { outcome: "Deny" } } });
      const response = await changeAction(harness, principal, preparedId(prepared), "confirmation");
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string; error_details: { error: string }[] };
      expect(body.error).toBe("access_denied");
      expect(body.error_details.map((detail) => detail.error).sort()).toEqual([...reasons].sort());
      expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
    };

    test("case A, the contact is not authenticated", async () => {
      await givenGrantCase(harness, { authenticatedAt: null });
      await refusedAtBoth("iac_alex", SEVEN_DAYS, ["policy.contact-is-authenticated"]);
    });

    test("case B, the contact's authentication expired", async () => {
      await givenGrantCase(harness, { authenticatedAt: at("14:20:00") });
      await refusedAtBoth("iac_alex", SEVEN_DAYS, ["policy.contact-is-authenticated"]);
    });

    test.each([
      { letter: "C", contact: "acc_carol" },
      { letter: "D", contact: "acc_bob" },
    ])("case $letter, a contact without grant.request in the subject", async ({ contact }) => {
      await givenGrantCase(harness, { subject: "acc_acme", contact });
      const prepared = await prepare(harness, "iac_alex", {
        kind: "CreateGrant",
        featureKey: "seats",
        quota: 5,
        durationDays: 5,
        reason: "More seats.",
      });
      const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");
      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).toContain("access.contact-permission-not-held");
    });

    test("case E, a CSR without grant.create", async () => {
      await givenGrantCase(harness, { assignee: "iac_drew", contact: null });
      const prepared = await prepare(harness, "iac_drew", SEVEN_DAYS);
      expect(prepared).toEqual({ kind: "NotFound" });
    });

    test("case F, a level-1 CSR on an Enterprise subject", async () => {
      await givenGrantCase(harness, { subject: "acc_umbrella", contact: null });
      const prepared = await prepare(harness, "iac_alex", SEVEN_DAYS);
      expect(prepared).toEqual({ kind: "Denied", reasonCodes: ["policy.enterprise-accounts-need-level-2"] });
    });

    test("case G, a suspended subject", async () => {
      await givenGrantCase(harness);
      await placeHold(harness.owner, "acc_initech", "OperationalSuspension", at("14:00:00"));
      await refusedAtBoth("iac_alex", SEVEN_DAYS, ["account.operational-suspension"]);
    });

    test("case H, a feature already included", async () => {
      await givenGrantCase(harness, { subject: "acc_acme", contact: null });
      const prepared = await prepare(harness, "iac_alex", SEVEN_DAYS);
      const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");
      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).toContain("entitlement.feature-already-included");
    });

    test("case I, a quota on an unmetered feature", async () => {
      await givenGrantCase(harness);
      await refusedAtBoth("iac_alex", { ...SEVEN_DAYS, quota: 5 }, [
        "entitlement.quota-on-unmetered-feature",
      ]);
    });

    test("case J, a quota over 100", async () => {
      await givenGrantCase(harness);
      await refusedAtBoth(
        "iac_alex",
        { kind: "CreateGrant", featureKey: "seats", quota: 150, durationDays: 5, reason: "Many seats." },
        ["policy.grant-quota-up-to-100"],
      );
    });

    test("case J2, quotas that overlap add up to over 100 (owner, 2026-10-27)", async () => {
      await givenGrantCase(harness);
      const seats = (quota: number) =>
        ({ kind: "CreateGrant", featureKey: "seats", quota, durationDays: 5, reason: "Seats." }) as const;
      const first = await changeAction(
        harness,
        "iac_alex",
        preparedId(await prepare(harness, "iac_alex", seats(60))),
        "confirmation",
      );
      expect(first.status).toBe(200);

      const second = await prepare(harness, "iac_alex", seats(60));

      expect(second).toMatchObject({
        changeRequest: { preview: { outcome: "Deny", reasonCodes: ["policy.grant-quota-up-to-100"] } },
      });
    });

    test("case K, over 90 days", async () => {
      await givenGrantCase(harness);
      await refusedAtBoth("iac_alex", { ...SEVEN_DAYS, durationDays: 120 }, [
        "policy.grants-up-to-14-days",
        "policy.grants-up-to-90-days",
      ]);
    });

    test("case L, a subscription that ended", async () => {
      await givenGrantCase(harness, { subject: "acc_stark", contact: null });
      const prepared = await prepare(harness, "iac_alex", SEVEN_DAYS);
      const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");
      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).toContain("entitlement.no-subscription");
    });
  });

  test("review R1-4 ensures a CSR who may no longer read the subject cannot read its change request", async () => {
    await givenGrantCase(harness);
    const id = preparedId(await prepare(harness, "iac_alex", SEVEN_DAYS));
    const read = () =>
      caseRequest(harness, "GET", `${casePath("cse_alex_1", "change-requests")}/${id}`, "iac_alex");
    expect((await read()).status).toBe(200);
    await harness.owner.query(
      "UPDATE employee SET department_key = 'finance', job_function_key = 'analyst' WHERE internal_identity_id = $1",
      [uuidOf("emp_alex")],
    );

    expect((await read()).status).toBe(404);
  });

  test("scenario 15a ensures the CSR cancels a prepared request", async () => {
    await givenGrantCase(harness);
    const id = preparedId(await prepare(harness, "iac_alex", SEVEN_DAYS));

    const canceled = await changeAction(harness, "iac_alex", id, "cancellation");
    const confirmed = await changeAction(harness, "iac_alex", id, "confirmation");

    expect(canceled.status).toBe(200);
    expect(await canceled.json()).toEqual({ status: "Canceled" });
    expect(confirmed.status).toBe(409);
    expect(JSON.stringify(await confirmed.json())).toContain("change_request_not_awaiting_confirmation");
    expect(await grantsOf(harness.owner, "acc_initech")).toEqual([]);
  });

  test("scenario 17a ensures confirmation is idempotent", async () => {
    await givenGrantCase(harness);
    const id = preparedId(await prepare(harness, "iac_alex", SEVEN_DAYS));

    const [first, second] = await Promise.all([
      changeAction(harness, "iac_alex", id, "confirmation"),
      changeAction(harness, "iac_alex", id, "confirmation"),
    ]);
    const third = await changeAction(harness, "iac_alex", id, "confirmation");

    for (const response of [first, second, third]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "Applied" });
    }
    expect(await grantsOf(harness.owner, "acc_initech")).toHaveLength(1);
  });
});

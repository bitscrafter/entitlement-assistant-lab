import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { seededUuid } from "../../../src/database/seed.ts";
import {
  changeAction,
  entitled,
  givenGrantCase,
  grantsOf,
  prepare,
  preparedId,
} from "../../support/grants.ts";
import { at, createHarness, type Harness, uuidOf } from "../../support/harness.ts";

const SEVEN_DAYS = {
  kind: "CreateGrant",
  featureKey: "audit-log-export",
  durationDays: 7,
  reason: "Evaluating exports.",
} as const;

describe("grants-and-approvals a grant's life", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  /** S21a's grant: audit-log-export at Initech, 7 days from 15:00. */
  const sevenDayGrant = async () => {
    await givenGrantCase(harness);
    const response = await changeAction(
      harness,
      "iac_alex",
      preparedId(await prepare(harness, "iac_alex", SEVEN_DAYS)),
      "confirmation",
    );
    expect(response.status).toBe(200);
    const [grant] = await grantsOf(harness.owner, "acc_initech");
    if (grant === undefined) throw new Error("no grant");
    return grant;
  };

  test("scenario 22a ensures a grant expires, and the account is back to its plan", async () => {
    await sevenDayGrant();

    harness.clock.setTo(new Date("2026-10-29T14:59:59Z"));
    expect(await entitled(harness, "acc_initech", "audit-log-export")).toMatchObject({ kind: "Entitled" });
    harness.clock.setTo(new Date("2026-10-29T15:00:00Z"));
    expect(await entitled(harness, "acc_initech", "audit-log-export")).toMatchObject({
      kind: "NotEntitled",
      reasonCodes: ["entitlement.feature-not-included"],
    });
    harness.clock.setTo(new Date("2026-10-29T15:15:00Z"));
    await harness.application.sweep();

    const [grant] = await grantsOf(harness.owner, "acc_initech");
    expect(grant).toMatchObject({ end_reason: "Expired", ended_at: new Date("2026-10-29T15:00:00Z") });
    const [record] = await harness.owner.query<{ actor_account_id: string }>(
      "SELECT actor_account_id FROM audit_chain_record WHERE action_key = 'grant.record-expiry'",
    );
    expect(record?.actor_account_id).toBe(uuidOf("iac_sys_grant_expiry"));
  });

  test("scenario 38a ensures revoking an active grant brings the account back to its plan", async () => {
    await givenGrantCase(harness, { subject: "acc_hooli", contact: "acc_gavin" });

    const prepared = await prepare(harness, "iac_alex", {
      kind: "RevokeGrant",
      grantId: seededUuid("grt_hooli_seats"),
      reason: "No longer needed.",
    });
    const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");

    expect(response.status).toBe(200);
    const seats = (await grantsOf(harness.owner, "acc_hooli")).find(
      (grant) => grant.grant_id === seededUuid("grt_hooli_seats"),
    );
    expect(seats).toMatchObject({ end_reason: "Revoked", ended_at: at("15:00:00") });
    expect(await entitled(harness, "acc_hooli", "seats")).toMatchObject({ kind: "Entitled", quota: 25 });
  });

  test("scenario 38b ensures only an active grant is revoked", async () => {
    await givenGrantCase(harness, { subject: "acc_hooli", contact: "acc_gavin" });

    const prepared = await prepare(harness, "iac_alex", {
      kind: "RevokeGrant",
      grantId: seededUuid("grt_hooli_old"),
      reason: "Tidy up.",
    });

    expect(prepared).toEqual({ kind: "GrantNotActive" });
  });

  test("scenario 39a ensures extending a valid grant within the limits is applied", async () => {
    const original = await sevenDayGrant();

    const prepared = await prepare(harness, "iac_alex", {
      kind: "ExtendGrant",
      grantId: original.grant_id,
      durationDays: 5,
      reason: "A few more days.",
    });
    expect(prepared).toMatchObject({ changeRequest: { preview: { outcome: "Allow" } } });
    const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");

    expect(response.status).toBe(200);
    const grants = await grantsOf(harness.owner, "acc_initech");
    expect(grants).toEqual([
      expect.objectContaining({
        grant_id: original.grant_id,
        end_reason: "Extended",
        ended_at: at("15:00:00"),
      }),
      expect.objectContaining({
        extends_grant_id: original.grant_id,
        starts_at: at("15:00:00"),
        expires_at: new Date("2026-11-03T15:00:00Z"),
        ended_at: null,
      }),
    ]);
    expect(await entitled(harness, "acc_initech", "audit-log-export")).toMatchObject({ kind: "Entitled" });
  });

  test("scenario 39b ensures extending past 14 days in all needs an approval", async () => {
    await givenGrantCase(harness, { subject: "acc_hooli", contact: "acc_gavin" });

    const prepared = await prepare(harness, "iac_alex", {
      kind: "ExtendGrant",
      grantId: seededUuid("grt_hooli_seats"),
      durationDays: 7,
      reason: "The team needs another week.",
    });
    expect(prepared).toMatchObject({
      changeRequest: { preview: { outcome: "Conditional", reasonCodes: ["policy.grants-up-to-14-days"] } },
    });
    const response = await changeAction(harness, "iac_alex", preparedId(prepared), "confirmation");

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "AwaitingApproval" });
  });

  test("scenario 39c ensures an expired grant is re-granted, its days counted", async () => {
    await givenGrantCase(harness, { subject: "acc_hooli", contact: "acc_gavin" });

    const extension = await prepare(harness, "iac_alex", {
      kind: "ExtendGrant",
      grantId: seededUuid("grt_hooli_old"),
      durationDays: 7,
      reason: "Again.",
    });
    const regrant = await prepare(harness, "iac_alex", {
      kind: "CreateGrant",
      featureKey: "seats",
      quota: 5,
      durationDays: 7,
      reason: "Seats for the migration again.",
    });

    expect(extension).toEqual({ kind: "GrantExpired" });
    expect(regrant).toMatchObject({
      changeRequest: { preview: { outcome: "Conditional", reasonCodes: ["policy.grants-up-to-14-days"] } },
    });
  });
});

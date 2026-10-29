import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { casePath, caseRequest, caseState, givenCase } from "../../support/case-lifecycle.ts";
import {
  at,
  auditRecords,
  createHarness,
  external,
  type Harness,
  insertCase,
} from "../../support/harness.ts";

describe("case-lifecycle setting the same contact again (owner, 2026-10-29)", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test("ensures a second Set as contact for the case's contact changes nothing and records nothing", async () => {
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
    await givenCase(harness.owner, "cse_alex_1", {
      subject: "acc_initech",
      contact: "acc_bob",
      authenticated: { at: at("14:55:00"), kind: "Knowledge", method: "SecurityQuestion", by: "iac_alex" },
    });
    const before = (await auditRecords(harness.owner)).length;

    const response = await caseRequest(harness, "PUT", casePath("cse_alex_1", "contact"), "iac_alex", {
      account_id: external("acc_bob"),
    });

    expect(response.status).toBe(204);
    expect((await caseState(harness.owner, "cse_alex_1")).row).toMatchObject({
      contact_authenticated_at: at("14:55:00"),
    });
    expect((await auditRecords(harness.owner)).length).toBe(before);
  });
});

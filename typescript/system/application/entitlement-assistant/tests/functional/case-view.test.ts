import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { accountIdOf, casePath, caseRequest, givenCase } from "../support/case-lifecycle.ts";
import { at, createHarness, type Harness, insertCase } from "../support/harness.ts";

describe("the case view (case-lifecycle D15, review R7)", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  test("ensures a contact without a subject shows no roles in the subject", async () => {
    await givenCase(harness.owner, "cse_alex_1", { contact: "acc_jane" });

    const response = await caseRequest(harness, "GET", casePath("cse_alex_1"), "iac_alex");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { subject: unknown; contact: unknown };
    expect(body.subject).toBeNull();
    expect(body.contact).toEqual({
      account_id: accountIdOf("acc_jane"),
      readable: true,
      display_name: "Jane Doe",
      holds: [],
      roles_in_subject: null,
    });
  });
});

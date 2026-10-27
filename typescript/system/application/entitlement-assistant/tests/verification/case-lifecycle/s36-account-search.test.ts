import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  accountIdOf,
  caseRequest,
  invalidRequest,
  lifecycleRecords,
  NOT_FOUND,
} from "../../support/case-lifecycle.ts";
import { createHarness, type Harness, ORIGIN, request } from "../../support/harness.ts";

const records = async (harness: Harness) =>
  (await lifecycleRecords(harness)).map((entry) => [
    entry.action_key,
    entry.actor,
    entry.subject,
    entry.audit_outcome,
    entry.reasons,
    entry.detail.use_case,
    entry.case,
  ]);

describe("case-lifecycle the case panel's account search (D18)", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  const search = (query: string, principal = "iac_alex") =>
    caseRequest(harness, "GET", `/api/accounts?query=${encodeURIComponent(query)}`, principal);

  test("scenario 36a ensures the case panel finds an account by id", async () => {
    const response = await search(accountIdOf("acc_acme"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: "found",
      account: { account_id: accountIdOf("acc_acme"), display_name: "Acme Corp", plan_key: "business" },
    });
    expect(await records(harness)).toEqual([
      ["account.read", "iac_alex", "acc_acme", "Allow", [], "FindCustomerAccount", null],
    ]);
  });

  test("scenario 36b ensures the case panel finds a person's accounts by email", async () => {
    const response = await search("jane@acme.com");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: "ambiguous",
      candidates: [
        {
          account_id: accountIdOf("acc_jane"),
          display_name: "Jane Doe",
          own_account: true,
          roles: ["owner"],
        },
        {
          account_id: accountIdOf("acc_acme"),
          display_name: "Acme Corp",
          own_account: false,
          roles: ["admin", "billing"],
        },
      ],
      more_matches: false,
    });
    expect((await records(harness)).map((record) => [record[2], record[3]]).sort()).toEqual([
      ["acc_acme", "Allow"],
      ["acc_jane", "Allow"],
    ]);
  });

  test("scenario 36c ensures the case panel's search by name is bounded — case A", async () => {
    const response = await search("acme");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: "ambiguous",
      candidates: [
        { account_id: accountIdOf("acc_acme"), display_name: "Acme Corp" },
        { account_id: accountIdOf("acc_acme_labs"), display_name: "Acme Labs" },
      ],
      more_matches: false,
    });
    expect(await records(harness)).toHaveLength(2);
  });

  test("scenario 36c ensures the case panel's search by name is bounded — case B", async () => {
    const response = await search(" a ");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(invalidRequest("query", "The query needs at least 3 characters."));
    expect(await records(harness)).toEqual([]);
  });

  test("scenario 36d ensures the case panel's search refuses as any read — case A", async () => {
    const response = await search("Umbrella");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "access_denied",
      error_details: [{ error: "policy.enterprise-accounts-need-level-2" }],
    });
    expect((await records(harness)).map((record) => [record[2], record[3]])).toEqual([
      ["acc_umbrella", "Deny"],
    ]);
  });

  test("scenario 36d ensures the case panel's search refuses as any read — case B", async () => {
    const response = await search("Massive Dynamic");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_FOUND);
    expect((await records(harness)).map((record) => [record[3], record[4]])).toEqual([
      ["Failed", ["support.no-matching-account"]],
    ]);
  });

  test("scenario 36d ensures the case panel's search refuses as any read — case C", async () => {
    const response = await search("Acme", "iac_drew");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_FOUND);
    expect((await records(harness)).map((record) => [record[1], record[3], record[4]])).toEqual([
      ["iac_drew", "Deny", ["access.permission-not-held"]],
    ]);
  });

  test("scenario 36d ensures the case panel's search refuses as any read — case D", async () => {
    const response = await harness.application.fetch(
      request("GET", "/api/accounts?query=Acme", { headers: { Origin: ORIGIN } }),
    );

    expect(response.status).toBe(401);
    expect(await records(harness)).toEqual([]);
  });

  test("scenario 36e ensures the case panel's search is rate-limited", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) statuses.push((await search("acme")).status);

    expect(statuses).toEqual([...Array(20).fill(200), 429]);
    expect(await records(harness)).toHaveLength(40);
  });

  test("invariant a query over 320 characters, or none, is refused before anything is read", async () => {
    const tooLong = await search("x".repeat(321));
    const missing = await caseRequest(harness, "GET", "/api/accounts", "iac_alex");

    expect(tooLong.status).toBe(400);
    expect(await tooLong.text()).toBe(invalidRequest("query", "The query is too long."));
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe(invalidRequest("query", "The query needs at least 3 characters."));
    expect(await records(harness)).toEqual([]);
  });
});

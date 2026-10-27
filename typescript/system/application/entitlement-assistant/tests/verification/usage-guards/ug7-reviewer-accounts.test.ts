import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { compact, createHarness, type Harness, ORIGIN, request } from "../../support/harness.ts";

describe("usage-guards reviewer accounts", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test.each([
    ["cf-alex", "Alex (cf)", "representative", 1, ["support-case-handling"]],
    ["cf-blair", "Blair (cf)", "representative", 2, ["subscription-cancellation", "support-case-handling"]],
    ["cf-morgan", "Morgan (cf)", "supervisor", 2, ["approval-decision", "case-supervision"]],
    ["cf-sam", "Sam (cf)", "supervisor", 1, ["approval-decision", "case-supervision"]],
    ["bc-alex", "Alex (bc)", "representative", 1, ["support-case-handling"]],
    ["bc-blair", "Blair (bc)", "representative", 2, ["subscription-cancellation", "support-case-handling"]],
    ["bc-morgan", "Morgan (bc)", "supervisor", 2, ["approval-decision", "case-supervision"]],
    ["bc-sam", "Sam (bc)", "supervisor", 1, ["approval-decision", "case-supervision"]],
  ])(
    "UG7 ensures %s signs in as %s, %s level %d",
    async (alias, displayName, jobFunction, jobLevel, roles) => {
      const signedIn = await harness.application.fetch(
        request("POST", "/api/authentication/sign-in", {
          headers: { Origin: ORIGIN, "Content-Type": "application/json" },
          body: compact({ email: `${alias}@provider.example`, password: `${alias}-demo-password` }),
        }),
      );
      expect(signedIn.status).toBe(204);
      const cookie = (signedIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      const session = await harness.application.fetch(
        request("GET", "/api/authentication/session", { headers: { Origin: ORIGIN, Cookie: cookie } }),
      );

      const principal = (await session.json()) as {
        display_name: string;
        job_function: string;
        job_level: number;
        roles: string[];
      };
      expect(principal).toMatchObject({
        display_name: displayName,
        job_function: jobFunction,
        job_level: jobLevel,
      });
      expect(principal.roles).toEqual(expect.arrayContaining(roles));
    },
  );
});

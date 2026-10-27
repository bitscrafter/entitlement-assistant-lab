import { describe, expect, test } from "vitest";
import { CASE_TOOLS, SUMMARY_WITH_EMAIL } from "../../src/agent/tools.ts";

const draft = (summary: string) => CASE_TOOLS.draft_case_summary?.run({ summary }, undefined as never);

describe("draft_case_summary (case-lifecycle discovery 17)", () => {
  test.each([
    "The contact is Jane Doe (email [jane@acme.com]).",
    "Reached jane@acme.com about SSO.",
    "Contact: <JANE.DOE@ACME.CO.UK>",
  ])("ensures a draft with an email is refused: %s", async (summary) => {
    expect(await draft(summary)).toEqual({ errorText: SUMMARY_WITH_EMAIL });
  });

  test("ensures a draft without an email is drafted as written", async () => {
    const summary = "The account is entitled to SSO under its Business plan; the contact was authenticated.";
    expect(await draft(summary)).toEqual({ output: { result: "drafted", summary } });
  });
});

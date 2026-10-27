import { describe, expect, test } from "vitest";
import { caseGuidance } from "../../src/ui/case-guidance.ts";
import type { CaseState } from "../../src/ui/cases-client.ts";

const NOW = new Date("2026-10-22T15:00:00Z");
const base: CaseState = {
  case_id: "cse_1",
  subject: { account_id: "acc_acme", readable: true, display_name: "Acme Corp", holds: [] },
  contact: {
    account_id: "acc_jane",
    readable: true,
    display_name: "Jane Doe",
    holds: [],
    roles_in_subject: ["admin"],
  },
  contact_authentication: {
    kind: "Knowledge",
    method: "SecurityQuestion",
    authenticated_by: "iac_alex",
    authenticated_at: "2026-10-22T14:50:00.000Z",
    expires_at: "2026-10-22T15:20:00.000Z",
  },
  opened_at: "2026-10-22T14:00:00.000Z",
  closed_at: null,
};

describe("caseGuidance (case-lifecycle D20)", () => {
  test("ensures nothing is said for an authenticated contact with a role in a readable subject", () => {
    expect(caseGuidance(base, NOW)).toEqual([]);
  });

  test("ensures nothing is said before a subject is set", () => {
    expect(caseGuidance({ ...base, subject: null }, NOW)).toEqual([]);
  });

  test("ensures an unreadable subject asks for a reassignment, and nothing else", () => {
    expect(caseGuidance({ ...base, subject: { account_id: "acc_acme", readable: false } }, NOW)).toEqual([
      "You may no longer read this account. Ask a supervisor to reassign the case.",
    ]);
  });

  test.each([
    ["not authenticated", null],
    [
      "expired",
      {
        ...base.contact_authentication,
        expires_at: "2026-10-22T15:00:00.000Z",
      } as CaseState["contact_authentication"],
    ],
  ])("ensures a contact %s is to be authenticated first", (_label, authentication) => {
    expect(caseGuidance({ ...base, contact_authentication: authentication }, NOW)).toEqual([
      "Authenticate the contact before sharing anything about Acme Corp.",
    ]);
  });

  test("ensures a contact with no role in the subject is told nothing about it", () => {
    const contact = { ...base.contact, roles_in_subject: [] } as CaseState["contact"];
    expect(caseGuidance({ ...base, contact }, NOW)).toEqual([
      "Jane Doe holds no role in Acme Corp: share nothing about it.",
    ]);
  });
});

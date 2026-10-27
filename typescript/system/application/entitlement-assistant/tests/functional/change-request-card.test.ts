import { describe, expect, test } from "vitest";
import { diffLines, type ReplyPart, replyViewOf } from "../../src/ui/reply-details.ts";

const prepared = (changeRequest: Record<string, unknown>): ReplyPart => ({
  type: "tool-prepare_grant",
  state: "output-available",
  input: {},
  output: { result: "prepared", change_request: changeRequest },
});

describe("the change request card (grants-and-approvals D1, D2)", () => {
  test("ensures a prepared grant becomes one card with its diff and preview", () => {
    const view = replyViewOf([
      prepared({
        change_request_id: "chg_1",
        change_kind: "CreateGrant",
        status: "AwaitingConfirmation",
        parameters: { feature_key: "audit-log-export", duration_days: 7, reason: "Evaluating exports." },
        diff: [{ op: "add", path: "/audit-log-export", value: { quota: null, sources: ["grant:new"] } }],
        preview: { outcome: "Allow", reasons: [] },
      }),
    ]);

    expect(view.changeRequests).toEqual([
      {
        changeRequestId: "chg_1",
        title: "Grant: Audit log export · 7 days",
        reason: "Evaluating exports.",
        changes: ["Adds Audit log export"],
        preview: "Allow",
        reasons: [],
      },
    ]);
  });

  test("ensures a refused preview keeps every reason as the CSR reads it (D17)", () => {
    const view = replyViewOf([
      prepared({
        change_request_id: "chg_2",
        change_kind: "CreateGrant",
        parameters: { feature_key: "seats", quota: 150, duration_days: 5, reason: "Many seats." },
        diff: [],
        preview: {
          outcome: "Deny",
          reasons: [
            { code: "policy.grant-quota-up-to-100", description: "A grant adds at most 100 to a quota." },
          ],
        },
      }),
    ]);

    expect(view.changeRequests[0]).toMatchObject({
      title: "Grant: Seats · +150 · 5 days",
      preview: "Deny",
      reasons: ["A grant adds at most 100 to a quota."],
    });
  });

  test("ensures the diff reads as quota changes, additions, removals, and new sources", () => {
    expect(
      diffLines([
        { op: "test", path: "/seats", value: { quota: 3, sources: ["plan:free"] } },
        { op: "replace", path: "/seats", value: { quota: 13, sources: ["plan:free", "grant:new"] } },
        { op: "test", path: "/sso", value: { quota: null, sources: ["grant:grt_old"] } },
        { op: "replace", path: "/sso", value: { quota: null, sources: ["grant:new"] } },
        { op: "test", path: "/api-access", value: { quota: null, sources: ["grant:grt_x"] } },
        { op: "remove", path: "/api-access" },
      ]),
    ).toEqual(["Seats: 3 → 13", "Sso: from the new grant", "Removes Api access"]);
  });

  test("ensures a card is listed once however many times the reply repeats it", () => {
    const part = prepared({
      change_request_id: "chg_3",
      change_kind: "RevokeGrant",
      parameters: {},
      preview: {},
    });
    expect(replyViewOf([part, part]).changeRequests).toHaveLength(1);
  });
});

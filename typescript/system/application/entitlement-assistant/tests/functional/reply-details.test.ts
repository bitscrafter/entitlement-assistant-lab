import { describe, expect, test } from "vitest";
import {
  dayOf,
  NO_ANSWER,
  type ReplyPart,
  replyViewOf,
  resolveReferences,
  sourceLabel,
  titleOf,
  UNKNOWN_ACCOUNT,
  UNKNOWN_PERSON,
} from "../../src/ui/reply-details.ts";

const ACME = "acc_AaD0wsQAcISy9edCLE0dkw";
const LABS = "acc_AaD0wsQAd8Wi84ul6NvJ-A";
const acmeAccount = {
  account_id: ACME,
  display_name: "Acme Corp",
  plan_key: "business",
  covering_term: { plan_key: "business", source: "Payment", ends_at: "2026-11-01T00:00:00.000Z" },
};
const labsAccount = {
  account_id: LABS,
  display_name: "Acme Labs",
  plan_key: "free",
  covering_term: { plan_key: "free", source: "FreePlan", ends_at: null },
};
const tool = (name: string, input: unknown, output: unknown): ReplyPart => ({
  type: `tool-${name}`,
  state: "output-available",
  input,
  output,
});

describe("replyViewOf", () => {
  test("ensures a check of two accounts gives one card each, with plan, term, the feature, and a remedy when missing", () => {
    const view = replyViewOf([
      { type: "step-start" },
      tool(
        "check_entitlement",
        { feature_key: "sso", account_id: ACME },
        {
          result: "entitled",
          account: acmeAccount,
          feature_key: "sso",
          quota: null,
          sources: ["plan:business"],
        },
      ),
      tool(
        "check_entitlement",
        { feature_key: "sso", account_id: LABS },
        {
          result: "not_entitled",
          account: labsAccount,
          feature_key: "sso",
          reasons: [
            {
              code: "entitlement.feature-not-included",
              description: "The account's plan, add-ons, and grants do not include it.",
            },
          ],
          facts: {},
          remedy: { lowest_plan_key: "business", addons: [] },
        },
      ),
      { type: "text", text: "Acme Corp has SSO; Acme Labs does not." },
    ]);
    expect(view.text).toBe("Acme Corp has SSO; Acme Labs does not.");
    expect(view.accounts).toEqual([
      {
        accountId: ACME,
        displayName: "Acme Corp",
        plan: "Business",
        term: "Payment, ends 2026-11-01",
        lines: [
          {
            kind: "feature",
            featureKey: "sso",
            included: true,
            quota: null,
            sources: ["Business plan"],
            reasons: [],
            remedy: null,
          },
        ],
      },
      {
        accountId: LABS,
        displayName: "Acme Labs",
        plan: "Free",
        term: "FreePlan, open-ended",
        lines: [
          {
            kind: "feature",
            featureKey: "sso",
            included: false,
            quota: null,
            sources: [],
            reasons: ["The account's plan, add-ons, and grants do not include it."],
            remedy: "lowest plan that includes it: Business",
          },
        ],
      },
    ]);
  });

  test("ensures identical tool calls are listed once with how many times", () => {
    const same = tool("find_customer_account", { query: "Acme" }, { result: "ambiguous", candidates: [] });
    const view = replyViewOf([
      same,
      same,
      tool("find_customer_account", { query: "Initech" }, { error: "not_found" }),
    ]);
    expect(view.tools.map((call) => [call.toolName, call.times])).toEqual([
      ["find_customer_account", 2],
      ["find_customer_account", 1],
    ]);
  });

  test("ensures several matches become choices with full ids, and refusals read in plain words", () => {
    const view = replyViewOf([
      tool(
        "find_customer_account",
        { query: "acme" },
        {
          result: "ambiguous",
          candidates: [{ account_id: ACME, display_name: "Acme Corp", own_account: false, roles: [] }],
        },
      ),
      tool(
        "find_customer_account",
        { query: "Umbrella" },
        {
          error: "access_denied",
          error_details: [
            {
              error: "policy.enterprise-accounts-need-level-2",
              error_description: "Enterprise accounts need job level 2 or a supervisor.",
            },
          ],
        },
      ),
    ]);
    expect(view.choices).toEqual([{ accountId: ACME, displayName: "Acme Corp", roles: [] }]);
    expect(view.refusals).toEqual([
      "Denied by policy: Enterprise accounts need job level 2 or a supervisor.",
    ]);
  });

  test("ensures an explanation shows who may do what, with the granting roles or every reason and the remedy", () => {
    const view = replyViewOf([
      tool(
        "explain_access",
        {},
        {
          result: "explained",
          account: acmeAccount,
          person_email: "carol@acme.com",
          feature_key: "api-access",
          operation: "create-token",
          outcome: "Deny",
          findings: [],
          reasons: [
            {
              code: "access.permission-not-held",
              description: "No role the person holds in this account allows it.",
            },
          ],
          facts: {},
          remedy: null,
        },
      ),
    ]);
    expect(view.accounts[0]?.lines).toEqual([
      {
        kind: "access",
        personEmail: "carol@acme.com",
        featureKey: "api-access",
        operation: "create-token",
        allowed: false,
        grantedBy: [],
        reasons: ["No role the person holds in this account allows it."],
        remedy: null,
      },
    ]);
  });

  test("ensures a tool refusal of its arguments is shown as refused, and its text kept", () => {
    const view = replyViewOf([
      {
        type: "tool-check_entitlement",
        state: "output-error",
        input: {},
        errorText: "Invalid input: expected string",
      },
    ]);
    expect(view.tools).toEqual([
      {
        toolName: "check_entitlement",
        state: "refused",
        input: {},
        output: undefined,
        errorText: "Invalid input: expected string",
        times: 1,
      },
    ]);
  });
});

describe("labels", () => {
  test("ensures keys, days, and sources read as a CSR writes them", () => {
    expect(titleOf("audit-log-export")).toBe("Audit log export");
    expect(dayOf("2026-11-01T00:00:00.000Z")).toBe("2026-11-01");
    expect(["plan:business", "addon:advanced-analytics", "grant:grt_x"].map(sourceLabel)).toEqual([
      "Business plan",
      "Advanced analytics add-on",
      "grant grt_x",
    ]);
  });
});

describe("replyViewOf, what a reply reports", () => {
  const acmeChecked = tool(
    "check_entitlement",
    { feature_key: "sso", account_id: ACME },
    {
      result: "entitled",
      account: acmeAccount,
      feature_key: "sso",
      quota: null,
      sources: ["plan:business"],
    },
  );
  const lookup = tool(
    "find_customer_account",
    { query: "Acme" },
    {
      result: "ambiguous",
      candidates: [
        { account_id: ACME, display_name: "Acme Corp", own_account: false, roles: [] },
        { account_id: LABS, display_name: "Acme Labs", own_account: false, roles: [] },
      ],
    },
  );

  test("ensures a not found is not reported when the reply went on to resolve an account", () => {
    const view = replyViewOf([
      tool("check_entitlement", { account_id: "acc_Acme" }, { error: "not_found" }),
      lookup,
      acmeChecked,
    ]);
    expect(view.refusals).toEqual([]);
  });

  test("ensures a not found is reported when nothing in the reply resolved", () => {
    expect(
      replyViewOf([tool("find_customer_account", { query: "Massive" }, { error: "not_found" })]).refusals,
    ).toEqual(["No account matched, or it is not one you may read."]);
  });

  test("ensures choices list only the matches the reply did not show as a card", () => {
    expect(replyViewOf([lookup, acmeChecked]).choices).toEqual([
      { accountId: LABS, displayName: "Acme Labs", roles: [] },
    ]);
  });
});

describe("replyViewOf, an answer written as a tool call", () => {
  test.each([
    '{"name": "list_entitlements", "parameters": {"account_id": "acc_AaD0wsQAcXKkJwEEfKpH9A"}}',
    'The function call to best answer the prompt is:\n\n{"name": "find_customer_account", "parameters": {"query": "Acme"}}',
  ])("ensures the answer is NO_ANSWER for %s", (text) => {
    expect(replyViewOf([{ type: "text", text }]).text).toBe(NO_ANSWER);
  });

  test("ensures an answer in words that mentions a name is kept", () => {
    const text = 'Acme Corp has SSO; its "name" on file is Acme Corp.';
    expect(replyViewOf([{ type: "text", text }]).text).toBe(text);
  });
});

describe("replyViewOf, names in the answer", () => {
  const explained = tool(
    "explain_access",
    {
      person_email: "carol@acme.com",
      account_id: ACME,
      feature_key: "api-access",
      operation: "create-token",
    },
    {
      result: "explained",
      account: acmeAccount,
      person_email: "carol@acme.com",
      outcome: "Deny",
      reasons: [],
      findings: [],
    },
  );

  test("ensures an account and a person referenced in the answer read as stored", () => {
    const view = replyViewOf([
      explained,
      { type: "text", text: `[CAROL@acme.com] cannot create API tokens in [${ACME}].` },
    ]);
    expect(view.text).toBe("carol@acme.com cannot create API tokens in Acme Corp.");
  });

  test("ensures a candidate of a several-match lookup is named as stored", () => {
    const view = replyViewOf([
      tool(
        "find_customer_account",
        { query: "Acme" },
        {
          result: "ambiguous",
          candidates: [
            { account_id: ACME, display_name: "Acme Corp", roles: [] },
            { account_id: LABS, display_name: "Acme Labs", roles: [] },
          ],
        },
      ),
      { type: "text", text: `Did you mean [${ACME}] or [${LABS}]?` },
    ]);
    expect(view.text).toBe("Did you mean Acme Corp or Acme Labs?");
  });

  test("ensures a reference that no tool of the reply returned is not given a name", () => {
    const view = replyViewOf([explained, { type: "text", text: `[${LABS}] and [dave@acme.com].` }]);
    expect(view.text).toBe(`${UNKNOWN_ACCOUNT} and ${UNKNOWN_PERSON}.`);
  });

  test("ensures text outside square brackets is kept as written", () => {
    const text = "Acme has SSO [see Details] until 2026-11-01.";
    expect(resolveReferences(text, new Map([[ACME, "Acme Corp"]]), new Map())).toBe(text);
  });
});

describe("replyViewOf, review round 1", () => {
  test("ensures an owner or admin a lookup returned is named as stored", () => {
    const view = replyViewOf([
      tool(
        "find_customer_account",
        { query: "Acme Corp" },
        {
          result: "found",
          account: { ...acmeAccount, owners_and_admins: ["jane@acme.com"] },
        },
      ),
      { type: "text", text: `[JANE@acme.com] administers [${ACME}].` },
    ]);
    expect(view.text).toBe("jane@acme.com administers Acme Corp.");
  });

  test("ensures a lookup that listed fewer than it matched says so", () => {
    const listed = (more: boolean) =>
      replyViewOf([
        tool(
          "find_customer_account",
          { query: "acme" },
          {
            result: "ambiguous",
            candidates: [{ account_id: ACME, display_name: "Acme Corp", own_account: false, roles: [] }],
            more_matches: more,
          },
        ),
      ]).moreMatches;
    expect([listed(true), listed(false)]).toEqual([true, false]);
  });
});

describe("replyViewOf, the name-search notice", () => {
  const lookup = (query: string, output: unknown) => tool("find_customer_account", { query }, output);
  const found = { result: "found", account: acmeAccount };

  test("ensures a search by part of a name is noticed, whatever it found", () => {
    const views = [
      replyViewOf([lookup("Acme Corp", found)]),
      replyViewOf([lookup("massive", { error: "not_found" })]),
    ];
    expect(views.map((view) => view.nameSearch)).toEqual([true, true]);
  });

  test("ensures a lookup by email or account id is not a name search", () => {
    const views = [replyViewOf([lookup("jane@acme.com", found)]), replyViewOf([lookup(ACME, found)])];
    expect(views.map((view) => view.nameSearch)).toEqual([false, false]);
  });
});

describe("replyViewOf, case lifecycle (case-lifecycle D1, D8)", () => {
  test("ensures a proposed subject shows as a card, offered once, and named as stored", () => {
    const proposed = tool(
      "propose_case_subject",
      { account_id: ACME },
      {
        result: "proposed",
        account: { account_id: ACME, display_name: "Acme Corp", plan_key: "business" },
      },
    );
    const view = replyViewOf([proposed, proposed, { type: "text", text: `[${ACME}] looks right.` }]);
    expect(view.proposedSubjects).toEqual([ACME]);
    expect(view.accounts.map((card) => card.accountId)).toEqual([ACME]);
    expect(view.text).toBe("Acme Corp looks right.");
  });

  test("ensures the last drafted summary is offered for review", () => {
    const drafted = (summary: string) =>
      tool("draft_case_summary", { summary }, { result: "drafted", summary });
    expect(replyViewOf([drafted("First."), drafted("Second.")]).draftedSummary).toBe("Second.");
    expect(replyViewOf([]).draftedSummary).toBeNull();
  });
});

describe("replyViewOf, a person's own account", () => {
  test("ensures a lookup by email offers the person's own account, and a lookup by name does not", () => {
    const byEmail = replyViewOf([
      tool(
        "find_customer_account",
        { query: "jane@acme.com" },
        {
          result: "ambiguous",
          candidates: [
            { account_id: LABS, display_name: "Jane Doe", own_account: true, roles: ["owner"] },
            { account_id: ACME, display_name: "Acme Corp", own_account: false, roles: ["admin"] },
          ],
        },
      ),
    ]);
    const byName = replyViewOf([
      tool("find_customer_account", { query: "Acme Corp" }, { result: "found", account: acmeAccount }),
    ]);
    expect(byEmail.ownAccounts).toEqual([LABS]);
    expect(byName.ownAccounts).toEqual([]);
  });
});

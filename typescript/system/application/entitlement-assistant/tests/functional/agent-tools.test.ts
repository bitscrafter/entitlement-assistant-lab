import { describe, expect, test } from "vitest";
import type { Uuid } from "../../../../kernel/identifier.ts";
import { ToolRefusal, turnErrorLogOf } from "../../src/agent/agent-tools.ts";
import { finalStepAnswersInWords } from "../../src/agent/instructions.ts";
import { CASE_TOOLS, type ToolContext } from "../../src/agent/tools.ts";
import type { CaseWorkUseCases } from "../../src/case-work-use-cases.ts";
import { external } from "../support/harness.ts";

const ALEX = "0199a1b2-0000-7000-8000-0000000a1e00" as Uuid;

function contextRecording(calls: unknown[]): ToolContext {
  const recording = (name: string) => ({
    execute: async (request: unknown) => {
      calls.push({ name, request });
      return { kind: "NotFound" };
    },
  });
  return {
    request: {
      principalAccountId: ALEX,
      sessionId: ALEX,
      caseId: null,
      toolCallId: "call_1",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    },
    runUseCases: (work) =>
      work({
        checkEntitlement: recording("checkEntitlement"),
        explainAccess: recording("explainAccess"),
      } as unknown as CaseWorkUseCases),
    describeReason: (code) => code,
  };
}

/** A context whose every use case answers `result`. */
function contextAnswering(result: unknown): ToolContext {
  const answering = { execute: async () => result };
  return {
    ...contextRecording([]),
    runUseCases: (work) =>
      work({
        findCustomerAccount: answering,
        explainAccess: answering,
      } as unknown as CaseWorkUseCases),
  };
}

describe("the case tools", () => {
  test("ensures a check reads the feature key in lowercase, as catalog keys are (CM-12)", async () => {
    const calls: { request: { featureKey: string } }[] = [];
    await CASE_TOOLS.check_entitlement?.run(
      { account_id: external("acc_acme"), feature_key: " SSO " },
      contextRecording(calls),
    );
    expect(calls.map((call) => call.request.featureKey)).toEqual(["sso"]);
  });

  test("ensures an explanation reads the feature key and operation in lowercase", async () => {
    const calls: { request: { featureKey: string; operation: string } }[] = [];
    await CASE_TOOLS.explain_access?.run(
      {
        person_email: "jane@acme.com",
        account_id: external("acc_acme"),
        feature_key: "SSO",
        operation: "Configure",
      },
      contextRecording(calls),
    );
    expect(calls.map((call) => [call.request.featureKey, call.request.operation])).toEqual([
      ["sso", "configure"],
    ]);
  });

  test("requires a string where the model wrote a nested call", async () => {
    const calls: unknown[] = [];
    const outcome = await CASE_TOOLS.check_entitlement?.run(
      { account_id: { function_name: "find_customer_account", args: ["Acme"] }, feature_key: "sso" },
      contextRecording(calls),
    );
    expect(outcome).toEqual({ errorText: expect.stringMatching(/expected string/) });
    expect(calls).toEqual([]);
  });
});

describe("finalStepAnswersInWords", () => {
  test("ensures tools are refused on the last step and allowed before it", () => {
    expect([0, 1, 2, 3, 4].map((step) => finalStepAnswersInWords(step, 5))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      { toolChoice: "none" },
    ]);
  });
});

describe("turnErrorLogOf", () => {
  test("ensures a refused argument logs the tool's name, never the arguments", () => {
    const invalidInput = Object.assign(
      new Error('Type validation failed: Value: {"person_email":"carol@acme.com"}'),
      {
        name: "AI_InvalidToolInputError",
        toolName: "explain_access",
      },
    );
    const logs = [
      turnErrorLogOf(invalidInput, "t1"),
      turnErrorLogOf(new ToolRefusal("carol@acme.com is not valid", "explain_access"), "t2"),
    ];
    expect(logs).toEqual([
      { log: "tool-arguments-refused", traceId: "t1", tool: "explain_access" },
      { log: "tool-arguments-refused", traceId: "t2", tool: "explain_access" },
    ]);
    expect(JSON.stringify(logs)).not.toContain("carol");
  });

  test("ensures any other error logs as a failed turn, with its message", () => {
    expect(turnErrorLogOf(new Error("connection reset"), "t3")).toEqual({
      log: "case-agent-turn-failed",
      traceId: "t3",
      message: "Error: connection reset",
    });
  });
});

describe("the case tools, as the review of round 2 asked", () => {
  test("ensures a query too short is refused as an argument, with the bound", async () => {
    const outcome = await CASE_TOOLS.find_customer_account?.run(
      { query: " a " },
      contextAnswering({ kind: "QueryTooShort" }),
    );
    expect(outcome).toEqual({ errorText: "The query needs at least 3 characters." });
  });

  test("ensures a lookup reports whether more accounts matched than it lists", async () => {
    const outcome = await CASE_TOOLS.find_customer_account?.run(
      { query: "northwind" },
      contextAnswering({ kind: "Ambiguous", candidates: [], moreMatches: true }),
    );
    expect(outcome).toEqual({ output: { result: "Ambiguous", candidates: [], more_matches: true } });
  });

  test("ensures an explanation reports the person's stored email, not the one the model wrote", async () => {
    const outcome = await CASE_TOOLS.explain_access?.run(
      {
        person_email: "CAROL@Acme.com",
        account_id: external("acc_acme"),
        feature_key: "api-access",
        operation: "create-token",
      },
      contextAnswering({
        kind: "Explained",
        account: { accountId: ALEX, displayName: "Acme Corp", planKey: "business", coveringTerm: null },
        personEmail: "carol@acme.com",
        outcome: "Deny",
        findings: [],
        reasonCodes: [],
        facts: {},
        remedy: null,
      }),
    );
    expect(outcome).toMatchObject({ output: { person_email: "carol@acme.com" } });
  });
});

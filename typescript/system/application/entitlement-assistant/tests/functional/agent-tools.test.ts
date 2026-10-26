import { describe, expect, test } from "vitest";
import type { Uuid } from "../../../../kernel/identifier.ts";
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

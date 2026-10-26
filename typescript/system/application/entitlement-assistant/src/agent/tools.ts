import { z } from "../../../../external/zod.ts";
import type { EntitlementSource, ReasonFacts } from "../../../../kernel/entitlement.ts";
import { decodeIdentifier, encodeIdentifier, type Uuid } from "../../../../kernel/identifier.ts";
import type { AccountSummary } from "../../../../subsystem/support/src/usecase/find-customer-account.ts";
import type { ReadRefusal, ReadRequest } from "../../../../subsystem/support/src/usecase/read-request.ts";
import type { CaseWorkUseCases } from "../case-work-use-cases.ts";
import { ERRORS } from "../http/responses.ts";

/** A tool as the model is told about it. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** What a tool returns to the model: a result, or why its arguments were refused. */
export type ToolOutcome = { readonly output: unknown } | { readonly errorText: string };

export interface ToolContext {
  /** The principal, session, case, and tool call: from the connection, never from the model (api.md §9). */
  readonly request: ReadRequest;
  readonly runUseCases: <Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>) => Promise<Value>;
  /** The fixed description of a reason code, as `error_details` carry it (api.md §3). */
  readonly describeReason: (reasonCode: string) => string;
}

interface CaseTool {
  readonly definition: ToolDefinition;
  run(argumentsWritten: unknown, context: ToolContext): Promise<ToolOutcome>;
}

const NOT_FOUND = { error: "not_found", error_description: ERRORS.not_found.description } as const;

/** A refusal as the model sees it: the same two levels as an HTTP response (AU-6, api.md §3). */
function refusal(result: ReadRefusal, describeReason: (reasonCode: string) => string): unknown {
  if (result.kind === "NotFound") return NOT_FOUND;
  return {
    error: "access_denied",
    error_description: "The request was denied by policy.",
    error_details: result.reasonCodes.map((code) => ({
      error: code,
      error_description: describeReason(code),
    })),
  };
}

const sourceOf = (source: EntitlementSource): string =>
  source.kind === "plan"
    ? `plan:${source.planKey}`
    : source.kind === "addon"
      ? `addon:${source.addonKey}`
      : `grant:${encodeIdentifier("grt", source.grantId)}`;

const factsOf = (facts: ReasonFacts) => ({
  ...(facts.lastTermSource === undefined ? {} : { last_term_source: facts.lastTermSource }),
  ...(facts.lastTermEndedAt === undefined ? {} : { last_term_ended_at: facts.lastTermEndedAt.toISOString() }),
});

const summaryOf = (account: AccountSummary) => ({
  account_id: encodeIdentifier("acc", account.accountId),
  display_name: account.displayName,
  account_category: account.accountCategory,
  holds: account.holds,
  plan_key: account.planKey,
  covering_term:
    account.coveringTerm === null
      ? null
      : { source: account.coveringTerm.source, ends_at: account.coveringTerm.endsAt?.toISOString() ?? null },
  addon_keys: account.addonKeys,
  owners_and_admins: account.ownersAndAdmins,
});

/** The first unknown or invalid field, as the model is told (an identity claim such as `acting_as` included). */
function argumentError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

/** A customer account id as the model writes it (`acc_…`); null when it is not one. */
function accountIdOf(written: string): Uuid | null {
  const decoded = decodeIdentifier("acc", written);
  return decoded.ok ? decoded.value : null;
}

const accountIdParameter = {
  type: "string",
  description: "A customer account id, as find_customer_account returns it (acc_…).",
};

const findArguments = z.strictObject({ query: z.string().min(1).max(320) });
const checkArguments = z.strictObject({ account_id: z.string().max(64), feature_key: z.string().max(64) });
const listArguments = z.strictObject({ account_id: z.string().max(64) });
const explainArguments = z.strictObject({
  person_email: z.string().max(320),
  account_id: z.string().max(64),
  feature_key: z.string().max(64),
  operation: z.string().max(64),
});

/** The tools of the case agent (api.md §9): one per use case, translation only (A1). */
export const CASE_TOOLS: Readonly<Record<string, CaseTool>> = {
  find_customer_account: {
    definition: {
      name: "find_customer_account",
      description:
        "Find a customer account by a person's email (their own account and every account where they hold a role), an account id (acc_…), or part of the account's name.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = findArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      const result = await context.runUseCases((useCases) =>
        useCases.findCustomerAccount.execute({ ...context.request, query: parsed.data.query }),
      );
      if (result.kind === "Found") return { output: { result: "Found", account: summaryOf(result.account) } };
      if (result.kind === "Ambiguous") {
        return {
          output: {
            result: "Ambiguous",
            candidates: result.candidates.map((candidate) => ({
              account_id: encodeIdentifier("acc", candidate.accountId),
              display_name: candidate.displayName,
              own_account: candidate.ownAccount,
              roles: candidate.roles,
            })),
          },
        };
      }
      return { output: refusal(result, context.describeReason) };
    },
  },
  check_entitlement: {
    definition: {
      name: "check_entitlement",
      description:
        "Check whether a customer account is entitled to one feature, with every source, or why not.",
      parameters: {
        type: "object",
        properties: { account_id: accountIdParameter, feature_key: { type: "string" } },
        required: ["account_id", "feature_key"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = checkArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      const accountId = accountIdOf(parsed.data.account_id);
      if (accountId === null) return { output: NOT_FOUND };
      const result = await context.runUseCases((useCases) =>
        useCases.checkEntitlement.execute({
          ...context.request,
          accountId,
          featureKey: parsed.data.feature_key,
        }),
      );
      if (result.kind === "Entitled") {
        return {
          output: {
            result: "Entitled",
            feature_key: parsed.data.feature_key,
            quota: result.quota,
            sources: result.sources.map(sourceOf),
            covering_term:
              result.coveringTerm === null
                ? null
                : {
                    source: result.coveringTerm.source,
                    ends_at: result.coveringTerm.endsAt?.toISOString() ?? null,
                  },
          },
        };
      }
      if (result.kind === "NotEntitled") {
        return {
          output: { result: "NotEntitled", reason_codes: result.reasonCodes, facts: factsOf(result.facts) },
        };
      }
      return { output: refusal(result, context.describeReason) };
    },
  },
  list_entitlements: {
    definition: {
      name: "list_entitlements",
      description: "List every effective entitlement of a customer account, or why it has none.",
      parameters: {
        type: "object",
        properties: { account_id: accountIdParameter },
        required: ["account_id"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = listArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      const accountId = accountIdOf(parsed.data.account_id);
      if (accountId === null) return { output: NOT_FOUND };
      const result = await context.runUseCases((useCases) =>
        useCases.listEntitlements.execute({ ...context.request, accountId }),
      );
      if (result.kind !== "Listed") return { output: refusal(result, context.describeReason) };
      return {
        output: {
          result: "Listed",
          entries: result.entries.map((entry) => ({
            feature_key: entry.featureKey,
            quota: entry.quota,
            sources: entry.sources.map(sourceOf),
          })),
          reason_codes: result.reasonCodes,
          facts: factsOf(result.facts),
        },
      };
    },
  },
  explain_access: {
    definition: {
      name: "explain_access",
      description:
        "Explain why a person can or cannot perform a feature operation in a customer account, with every reason and a remedy.",
      parameters: {
        type: "object",
        properties: {
          person_email: { type: "string" },
          account_id: accountIdParameter,
          feature_key: { type: "string" },
          operation: { type: "string" },
        },
        required: ["person_email", "account_id", "feature_key", "operation"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = explainArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      const accountId = accountIdOf(parsed.data.account_id);
      if (accountId === null) return { output: NOT_FOUND };
      const result = await context.runUseCases((useCases) =>
        useCases.explainAccess.execute({
          ...context.request,
          personEmail: parsed.data.person_email,
          accountId,
          featureKey: parsed.data.feature_key,
          operation: parsed.data.operation,
        }),
      );
      if (result.kind !== "Explained") return { output: refusal(result, context.describeReason) };
      return {
        output: {
          result: "Explained",
          outcome: result.outcome,
          findings: result.findings.map((finding) =>
            finding.kind === "access"
              ? { kind: "access", granted_by_roles: finding.grantedByRoles }
              : {
                  kind: "entitlement",
                  sources: finding.sources.map(sourceOf),
                  covering_term_source: finding.coveringTermSource,
                },
          ),
          reason_codes: result.reasonCodes,
          facts: factsOf(result.facts),
          remedy:
            result.remedy === null
              ? null
              : {
                  lowest_plan_key: result.remedy.lowestPlanKey,
                  addons: result.remedy.addons.map((addon) => ({
                    addon_key: addon.addonKey,
                    eligible_plan_keys: addon.eligiblePlanKeys,
                  })),
                },
        },
      };
    },
  },
};

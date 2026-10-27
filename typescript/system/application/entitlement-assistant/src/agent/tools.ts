import { z } from "../../../../external/zod.ts";
import type { EntitlementSource, ReasonFacts } from "../../../../kernel/entitlement.ts";
import { decodeIdentifier, encodeIdentifier, type Uuid } from "../../../../kernel/identifier.ts";
import type { Remedy } from "../../../../subsystem/product/src/usecase/find-lowest-plan-including.ts";
import type { ChangeAsked } from "../../../../subsystem/support/src/model/change-request.ts";
import {
  type AccountSummary,
  type FindCustomerAccountResult,
  MINIMUM_QUERY_LENGTH,
} from "../../../../subsystem/support/src/usecase/find-customer-account.ts";
import type { PrepareChangeRequestResult } from "../../../../subsystem/support/src/usecase/prepare-change-request.ts";
import type {
  AccountContext,
  NotCaseSubject,
  ReadRefusal,
  ReadRequest,
} from "../../../../subsystem/support/src/usecase/read-request.ts";
import type { CaseWorkUseCases } from "../case-work-use-cases.ts";
import { diffBody, parametersBody } from "../change-request-body.ts";
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

/** The refusal of a read of another account than the case's subject (case-lifecycle D6). */
export const OTHER_ACCOUNT = "This case is about another account; open a new case for this one.";

/**
 * A read's refusal as the tool answers it: the subject rule as a refusal of the arguments, the others as their
 * error (AU-6).
 */
function refused(
  result: ReadRefusal | NotCaseSubject,
  describeReason: (reasonCode: string) => string,
): ToolOutcome {
  return result.kind === "NotCaseSubject"
    ? { errorText: OTHER_ACCOUNT }
    : { output: refusal(result, describeReason) };
}

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

/** The account a result is about, as the Details of a reply show it: the full id, its name, plan, and term. */
const accountOf = (account: AccountContext) => ({
  account_id: encodeIdentifier("acc", account.accountId),
  display_name: account.displayName,
  plan_key: account.planKey,
  covering_term:
    account.coveringTerm === null
      ? null
      : {
          plan_key: account.coveringTerm.planKey ?? account.planKey,
          source: account.coveringTerm.source,
          ends_at: account.coveringTerm.endsAt?.toISOString() ?? null,
        },
});

/** Each reason with how it reads to a CSR. */
const reasonsOf = (reasonCodes: readonly string[], describeReason: (reasonCode: string) => string) =>
  reasonCodes.map((code) => ({ code, description: describeReason(code) }));

const remedyOf = (remedy: Remedy | null) =>
  remedy === null
    ? null
    : {
        lowest_plan_key: remedy.lowestPlanKey,
        addons: remedy.addons.map((addon) => ({
          addon_key: addon.addonKey,
          eligible_plan_keys: addon.eligiblePlanKeys,
        })),
      };

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

/**
 * A lookup's answer as the model and the case panel both receive it (explain-access §3, case-lifecycle D18): one
 * shape, so the panel's search and the tool cannot drift apart.
 */
export function lookupOutputOf(
  result: Extract<FindCustomerAccountResult, { readonly kind: "Found" | "Ambiguous" }>,
): unknown {
  if (result.kind === "Found") return { result: "found", account: summaryOf(result.account) };
  return {
    result: "ambiguous",
    candidates: result.candidates.map((candidate) => ({
      account_id: encodeIdentifier("acc", candidate.accountId),
      display_name: candidate.displayName,
      own_account: candidate.ownAccount,
      roles: candidate.roles,
    })),
    more_matches: result.moreMatches,
  };
}

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
const featureKeyParameter = {
  type: "string",
  description:
    "A lowercase feature key, such as seats, api-access, sso, audit-log-export, or advanced-analytics.",
};

const findArguments = z.strictObject({ query: z.string().min(1).max(320) });
/** Catalog keys are lowercase kebab-case (CM-12); a model writing `SSO` means `sso`. */
const catalogKey = z
  .string()
  .max(64)
  .transform((key) => key.trim().toLowerCase());

const checkArguments = z.strictObject({ account_id: z.string().max(64), feature_key: catalogKey });
const listArguments = z.strictObject({ account_id: z.string().max(64) });
/** A draft is stored only as the CSR submits it, so it is bounded like the stored summary (D7, D8). */
const summaryArguments = z.strictObject({ summary: z.string().trim().min(1).max(4000) });
const explainArguments = z.strictObject({
  person_email: z.string().max(320),
  account_id: z.string().max(64),
  feature_key: catalogKey,
  operation: catalogKey,
});

/** A change's free-text reason, kept as the CSR's record of why (never acted on): bounded like a short note. */
const changeReason = z.string().trim().min(1).max(500);
/** A grant lasts whole days; the policies decide how many may be granted (grants-and-approvals D5). */
const durationDays = z.number().int().min(1).max(365);
const grantArguments = z.strictObject({
  feature_key: catalogKey,
  quota: z.number().int().min(1).max(100000).optional(),
  duration_days: durationDays,
  reason: changeReason,
});
const revocationArguments = z.strictObject({ grant_id: z.string().max(64), reason: changeReason });
const extensionArguments = z.strictObject({
  grant_id: z.string().max(64),
  duration_days: durationDays,
  reason: changeReason,
});

const grantIdParameter = {
  type: "string",
  description:
    "A grant id of the case's account, as list_entitlements or check_entitlement shows it (grt_…).",
};
const reasonParameter = {
  type: "string",
  description: "Why, in the representative's words, at most 500 characters.",
};
const durationParameter = { type: "integer", minimum: 1, maximum: 365, description: "How many days." };

/** A grant id as the model writes it (`grt_…`); null when it is not one. */
function grantIdOf(written: string): Uuid | null {
  const decoded = decodeIdentifier("grt", written);
  return decoded.ok ? decoded.value : null;
}

const NOT_THIS_ACCOUNTS_GRANT = "This grant is not one of the case's account.";

/** Prepares a change on the case's subject and answers as the change request card is drawn (D1, D2). */
async function prepareChange(change: ChangeAsked, context: ToolContext): Promise<ToolOutcome> {
  const caseId = context.request.caseId;
  if (caseId === null) return { errorText: "Changes are prepared in a case." };
  const result: PrepareChangeRequestResult = await context.runUseCases((useCases) =>
    useCases.prepareChangeRequest.execute({ ...context.request, caseId, change }),
  );
  switch (result.kind) {
    case "Prepared": {
      const prepared = result.changeRequest;
      return {
        output: {
          result: "prepared",
          change_request: {
            change_request_id: encodeIdentifier("chg", prepared.changeRequestId),
            change_kind: prepared.kind,
            status: prepared.status,
            parameters: parametersBody(prepared.change),
            diff: diffBody(prepared.diff),
            preview: {
              outcome: prepared.preview.outcome,
              reasons: reasonsOf(prepared.preview.reasonCodes, context.describeReason),
            },
          },
        },
      };
    }
    case "SubjectNotSet":
      return { errorText: "Set the case's subject before preparing a change." };
    case "UnknownFeature":
      return { errorText: "This feature is not in the catalog." };
    case "GrantNotFound":
      return { errorText: NOT_THIS_ACCOUNTS_GRANT };
    case "GrantNotActive":
      return { errorText: "This grant is not active." };
    case "GrantExpired":
      return { errorText: "This grant has expired: prepare a new grant." };
    case "CaseNotFound":
    case "CaseNotAssigned":
      return { errorText: "This case is closed." };
    case "Forbidden":
      return { output: NOT_FOUND };
    default:
      return { output: refusal(result, context.describeReason) };
  }
}

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
      if (result.kind === "QueryTooShort")
        return { errorText: `The query needs at least ${MINIMUM_QUERY_LENGTH} characters.` };
      if (result.kind === "Found" || result.kind === "Ambiguous") return { output: lookupOutputOf(result) };
      return refused(result, context.describeReason);
    },
  },
  check_entitlement: {
    definition: {
      name: "check_entitlement",
      description:
        "Check whether a customer account is entitled to one feature, with every source, or why not.",
      parameters: {
        type: "object",
        properties: { account_id: accountIdParameter, feature_key: featureKeyParameter },
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
            result: "entitled",
            account: accountOf(result.account),
            feature_key: parsed.data.feature_key,
            quota: result.quota,
            sources: result.sources.map(sourceOf),
          },
        };
      }
      if (result.kind === "NotEntitled") {
        return {
          output: {
            result: "not_entitled",
            account: accountOf(result.account),
            feature_key: parsed.data.feature_key,
            reasons: reasonsOf(result.reasonCodes, context.describeReason),
            facts: factsOf(result.facts),
            remedy: remedyOf(result.remedy),
          },
        };
      }
      return refused(result, context.describeReason);
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
      if (result.kind !== "Listed") return refused(result, context.describeReason);
      return {
        output: {
          result: "listed",
          account: accountOf(result.account),
          entries: result.entries.map((entry) => ({
            feature_key: entry.featureKey,
            quota: entry.quota,
            sources: entry.sources.map(sourceOf),
          })),
          reasons: reasonsOf(result.reasonCodes, context.describeReason),
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
          feature_key: featureKeyParameter,
          operation: {
            type: "string",
            description: "A lowercase feature operation, such as configure or create-token.",
          },
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
      if (result.kind !== "Explained") return refused(result, context.describeReason);
      return {
        output: {
          result: "explained",
          account: accountOf(result.account),
          person_email: result.personEmail,
          feature_key: parsed.data.feature_key,
          operation: parsed.data.operation,
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
          reasons: reasonsOf(result.reasonCodes, context.describeReason),
          facts: factsOf(result.facts),
          remedy: remedyOf(result.remedy),
        },
      };
    },
  },
  propose_case_subject: {
    definition: {
      name: "propose_case_subject",
      description:
        "Propose the account this case is about. It sets nothing: the representative sets the subject with a button.",
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
        useCases.proposeCaseSubject.execute({ ...context.request, accountId }),
      );
      if (result.kind === "SubjectAlreadySet") return { errorText: "This case's subject is already set." };
      if (result.kind !== "Proposed") return refused(result, context.describeReason);
      return {
        output: {
          result: "proposed",
          account: {
            account_id: encodeIdentifier("acc", result.account.accountId),
            display_name: result.account.displayName,
            plan_key: result.account.planKey,
          },
        },
      };
    },
  },
  prepare_grant: {
    definition: {
      name: "prepare_grant",
      description:
        "Prepare a temporary grant of a feature to the case's account, for the representative to confirm on a card. It changes nothing by itself. Give a quota only for a metered feature such as seats.",
      parameters: {
        type: "object",
        properties: {
          feature_key: featureKeyParameter,
          quota: { type: "integer", minimum: 1, description: "Added quota, for a metered feature only." },
          duration_days: durationParameter,
          reason: reasonParameter,
        },
        required: ["feature_key", "duration_days", "reason"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = grantArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      return prepareChange(
        {
          kind: "CreateGrant",
          featureKey: parsed.data.feature_key,
          ...(parsed.data.quota === undefined ? {} : { quota: parsed.data.quota }),
          durationDays: parsed.data.duration_days,
          reason: parsed.data.reason,
        },
        context,
      );
    },
  },
  prepare_grant_revocation: {
    definition: {
      name: "prepare_grant_revocation",
      description:
        "Prepare ending an active grant of the case's account now, for the representative to confirm on a card. It changes nothing by itself.",
      parameters: {
        type: "object",
        properties: { grant_id: grantIdParameter, reason: reasonParameter },
        required: ["grant_id", "reason"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = revocationArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      const grantId = grantIdOf(parsed.data.grant_id);
      if (grantId === null) return { errorText: NOT_THIS_ACCOUNTS_GRANT };
      return prepareChange({ kind: "RevokeGrant", grantId, reason: parsed.data.reason }, context);
    },
  },
  prepare_grant_extension: {
    definition: {
      name: "prepare_grant_extension",
      description:
        "Prepare extending an active grant of the case's account by some days, for the representative to confirm on a card. It changes nothing by itself. An expired grant is not extended: prepare a new grant.",
      parameters: {
        type: "object",
        properties: { grant_id: grantIdParameter, duration_days: durationParameter, reason: reasonParameter },
        required: ["grant_id", "duration_days", "reason"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten, context) {
      const parsed = extensionArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      const grantId = grantIdOf(parsed.data.grant_id);
      if (grantId === null) return { errorText: NOT_THIS_ACCOUNTS_GRANT };
      return prepareChange(
        { kind: "ExtendGrant", grantId, durationDays: parsed.data.duration_days, reason: parsed.data.reason },
        context,
      );
    },
  },
  draft_case_summary: {
    definition: {
      name: "draft_case_summary",
      description:
        "Draft the case's summary for the representative to review when closing. It stores nothing. Plain text, at most 4,000 characters.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
    async run(argumentsWritten) {
      const parsed = summaryArguments.safeParse(argumentsWritten);
      if (!parsed.success) return { errorText: argumentError(parsed.error) };
      return { output: { result: "drafted", summary: parsed.data.summary } };
    },
  },
};

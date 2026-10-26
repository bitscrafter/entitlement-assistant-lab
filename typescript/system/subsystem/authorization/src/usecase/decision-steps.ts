import type { Finding } from "../../../../port/authorization-decider.ts";
import type { LoadPrincipalPermissions } from "../../../access/src/usecase/load-principal-permissions.ts";
import type { EvaluatePolicies, PolicyAttributes } from "../../../policy/src/usecase/evaluate-policies.ts";
import type { GetCatalog } from "../../../product/src/usecase/get-catalog.ts";
import type { DecisionAttributes } from "./decision-attributes.ts";

/** One handler of the decision chain (AU-1): adds a finding, or none, and says whether the chain stops. */
export interface DecisionStep {
  decide(
    attributes: DecisionAttributes,
  ): Promise<{ readonly finding: Finding | null; readonly stops: boolean }>;
}

/** Employees still read a suspended account; every other action on it stops (AC-6). */
const READS_ALLOWED_ON_SUSPENDED_SUBJECTS: ReadonlySet<string> = new Set(["account.read", "audit.read"]);

/** `feature.<feature_key>.<operation>` names a feature action; the feature key is its middle part. */
export function featureKeyOf(actionKey: string): string | null {
  const parts = actionKey.split(".");
  return parts.length === 3 && parts[0] === "feature" ? (parts[1] ?? null) : null;
}

/**
 * The account step: a principal that may not act, or a suspended subject of an action other than a read,
 * ends the chain with the holds' reason codes.
 */
export class AccountStep implements DecisionStep {
  async decide(attributes: DecisionAttributes) {
    const principal = await attributes.principal();
    if (principal.kind === "MayNotAct") {
      return {
        finding: { source: "account", outcome: "Deny", reasonCodes: principal.reasonCodes } as const,
        stops: true,
      };
    }
    const subject = await attributes.subject();
    const subjectHolds = subject?.account.holdReasonCodes ?? [];
    if (subjectHolds.length > 0 && !READS_ALLOWED_ON_SUSPENDED_SUBJECTS.has(attributes.request.actionKey)) {
      return {
        finding: { source: "account", outcome: "Deny", reasonCodes: subjectHolds } as const,
        stops: true,
      };
    }
    return { finding: null, stops: false };
  }
}

/** The access step: nothing is allowed unless a role or assignment grants the permission (AU-3). */
export class AccessStep implements DecisionStep {
  readonly #loadPrincipalPermissions: LoadPrincipalPermissions;

  constructor(loadPrincipalPermissions: LoadPrincipalPermissions) {
    this.#loadPrincipalPermissions = loadPrincipalPermissions;
  }

  async decide(attributes: DecisionAttributes) {
    const principal = await attributes.principal();
    const holdings =
      principal.kind === "Employee"
        ? await this.#loadPrincipalPermissions.execute(
            { kind: "Employee", employee: principal.employee },
            attributes.now,
          )
        : principal.kind === "Individual" && attributes.request.subjectAccountId !== null
          ? await this.#loadPrincipalPermissions.execute(
              {
                kind: "Individual",
                accountId: principal.account.accountId,
                contextAccountId: attributes.request.subjectAccountId,
              },
              attributes.now,
            )
          : new Map<string, readonly string[]>();
    const roles = holdings.get(attributes.request.actionKey);
    const finding: Finding =
      roles === undefined
        ? {
            source: "access",
            outcome: "Deny",
            reasonCodes: ["access.permission-not-held"],
            grantedByRoles: [],
          }
        : { source: "access", outcome: "Allow", reasonCodes: [], grantedByRoles: roles };
    return { finding, stops: false };
  }
}

/** The contact access step (SU-8): a contact's customer permission; no action in this feature has a contact. */
export class ContactAccessStep implements DecisionStep {
  async decide() {
    return { finding: null, stops: false };
  }
}

/** The entitlement step: a feature action needs the subject entitled to the feature (EN-6). */
export class EntitlementStep implements DecisionStep {
  async decide(attributes: DecisionAttributes) {
    const featureKey = featureKeyOf(attributes.request.actionKey);
    if (featureKey === null) return { finding: null, stops: false };
    const subject = await attributes.subject();
    if (subject === null) throw new Error("A feature action was decided without a subject account.");
    const effective = subject.effective;
    if (effective.kind === "None") {
      const finding: Finding = {
        source: "entitlement",
        outcome: "Deny",
        reasonCodes: effective.reasonCodes,
        sources: [],
        coveringTermSource: null,
        facts: effective.facts,
      };
      return { finding, stops: false };
    }
    const entitlement = effective.entitlements.find((candidate) => candidate.featureKey === featureKey);
    const finding: Finding =
      entitlement === undefined
        ? {
            source: "entitlement",
            outcome: "Deny",
            reasonCodes: ["entitlement.feature-not-included"],
            sources: [],
            coveringTermSource: effective.coveringTerm.source,
            facts: {},
          }
        : {
            source: "entitlement",
            outcome: "Allow",
            reasonCodes: [],
            sources: entitlement.sources,
            coveringTermSource: effective.coveringTerm.source,
            facts: {},
          };
    return { finding, stops: false };
  }
}

/** The policy step: every applicable policy (PO-3), over attributes the PIP loaded from trusted data (AU-5). */
export class PolicyStep implements DecisionStep {
  readonly #evaluatePolicies: EvaluatePolicies;
  readonly #getCatalog: GetCatalog;

  constructor(evaluatePolicies: EvaluatePolicies, getCatalog: GetCatalog) {
    this.#evaluatePolicies = evaluatePolicies;
    this.#getCatalog = getCatalog;
  }

  async decide(attributes: DecisionAttributes) {
    const finding = await this.#evaluatePolicies.execute({
      actionKey: attributes.request.actionKey,
      attributes: await this.#policyAttributes(attributes),
    });
    if (finding.outcome === "Allow") return { finding: null, stops: false };
    return { finding: { source: "policy", ...finding } as const, stops: false };
  }

  async #policyAttributes(attributes: DecisionAttributes): Promise<PolicyAttributes> {
    const principal = await attributes.principal();
    const subject = await attributes.subject();
    const plan =
      subject?.latestPlanKey === null || subject === null
        ? undefined
        : (await this.#getCatalog.execute()).plans.find(
            (candidate) => candidate.planKey === subject.latestPlanKey,
          );
    const featureKey = featureKeyOf(attributes.request.actionKey);
    return {
      principal:
        principal.kind === "Employee"
          ? {
              account_id: principal.employee.accountId,
              account_kind: "Internal",
              identity_kind: "Employee",
              department: principal.employee.departmentKey,
              job_function: principal.employee.jobFunctionKey,
              job_level: principal.employee.jobLevel,
            }
          : { account_id: attributes.request.principal.accountId, account_kind: "Customer" },
      resource:
        subject === null
          ? {}
          : {
              account_id: subject.account.accountId,
              account_category: subject.account.accountCategory,
              ...(plan === undefined
                ? {}
                : { plan_key: plan.planKey, plan_ladder_key: plan.planLadderKey, tier_rank: plan.tierRank }),
            },
      context: {
        action_key: attributes.request.actionKey,
        ...(featureKey === null ? {} : { feature_key: featureKey }),
      },
      environment: { now: attributes.now },
    };
  }
}

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

/** The case lifecycle keys (SU-9): they act on the case, not on the account they name. */
const CASE_LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set([
  "case.set-subject",
  "case.set-contact",
  "case.authenticate-contact",
  "case.close",
]);

/**
 * Employees still read a suspended account, and still handle a case about it or with it as the contact; every
 * other action on it stops (AC-6; case-lifecycle S33j, S27i).
 */
const ACTIONS_ALLOWED_ON_SUSPENDED_SUBJECTS: ReadonlySet<string> = new Set([
  "account.read",
  "audit.read",
  "change-request.cancel",
  ...CASE_LIFECYCLE_ACTIONS,
]);

/** @ensures Whether an action may proceed on a subject account that has holds. */
export function allowedOnSuspendedSubject(actionKey: string): boolean {
  return ACTIONS_ALLOWED_ON_SUSPENDED_SUBJECTS.has(actionKey);
}

/**
 * The permission that governs an action (AU-3): its own key, except the case lifecycle keys, held through
 * `case.open` (SU-14, case-lifecycle D11).
 *
 * @ensures `case.open` for a case lifecycle key; the action key itself otherwise.
 */
export function governingPermissionOf(actionKey: string): string {
  if (CASE_LIFECYCLE_ACTIONS.has(actionKey)) return "case.open";
  return GOVERNED_BY[actionKey] ?? actionKey;
}

/** Actions held through another action's permission: revoking a grant is part of granting (grants-and-approvals D12). */
const GOVERNED_BY: Readonly<Record<string, string>> = {
  "grant.revoke": "grant.create",
  // Canceling a change request is handling the case (grants-and-approvals D14).
  "change-request.cancel": "case.open",
  // The approval process expires what it would otherwise apply (grants-and-approvals D9).
  "approval.expire": "change-request.apply",
};

/** The grant changes (grants-and-approvals D1): judged by the entitlement step's grant rules (EN-4). */
const GRANT_CREATING_ACTIONS: ReadonlySet<string> = new Set(["grant.create"]);

/**
 * The customer permission a contact needs for the employee action done at their request (SU-8, grants-and-approvals
 * D3): only these actions are asked for by a contact.
 */
const CUSTOMER_PERMISSION_OF: Readonly<Record<string, string>> = {
  "grant.create": "grant.request",
  "grant.revoke": "grant.request",
  "subscription.change-plan": "subscription.request-plan-change",
  "subscription.cancel": "subscription.request-cancellation",
};

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
    if (subjectHolds.length > 0 && !allowedOnSuspendedSubject(attributes.request.actionKey)) {
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
        : principal.kind === "System"
          ? await this.#loadPrincipalPermissions.execute(
              { kind: "System", accountId: principal.accountId },
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
    const roles = holdings.get(governingPermissionOf(attributes.request.actionKey));
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

/**
 * The contact access step (SU-8): a change asked for by the case's contact needs the contact to hold the matching
 * customer permission in the subject. A contact with holds holds nothing (AC-6). No finding without a contact, or for
 * an action a contact does not ask for.
 */
export class ContactAccessStep implements DecisionStep {
  readonly #loadPrincipalPermissions: LoadPrincipalPermissions;

  constructor(loadPrincipalPermissions: LoadPrincipalPermissions) {
    this.#loadPrincipalPermissions = loadPrincipalPermissions;
  }

  async decide(attributes: DecisionAttributes) {
    const { contactAccountId, subjectAccountId, actionKey } = attributes.request;
    const customerPermission = CUSTOMER_PERMISSION_OF[actionKey];
    if (contactAccountId === undefined || contactAccountId === null || customerPermission === undefined)
      return { finding: null, stops: false };
    if (subjectAccountId === null)
      throw new Error("A contact's request was decided without a subject account.");
    const contact = await attributes.contact();
    const roles =
      contact === null || contact.holdReasonCodes.length > 0
        ? undefined
        : (
            await this.#loadPrincipalPermissions.execute(
              { kind: "Individual", accountId: contactAccountId, contextAccountId: subjectAccountId },
              attributes.now,
            )
          ).get(customerPermission);
    const finding: Finding =
      roles === undefined
        ? {
            source: "contact-access",
            outcome: "Deny",
            reasonCodes: ["access.contact-permission-not-held"],
            grantedByRoles: [],
          }
        : { source: "contact-access", outcome: "Allow", reasonCodes: [], grantedByRoles: roles };
    return { finding, stops: false };
  }
}

/**
 * The entitlement step: a feature action needs the subject entitled to the feature (EN-6); a grant must change what
 * the subject has (EN-4).
 */
export class EntitlementStep implements DecisionStep {
  async decide(attributes: DecisionAttributes) {
    if (GRANT_CREATING_ACTIONS.has(attributes.request.actionKey)) return decideGrantChange(attributes);
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

/** The grant rules (EN-4) over the subject's entitlements now; a grant without a feature is a caller's error. */
async function decideGrantChange(attributes: DecisionAttributes) {
  const featureKey = attributes.request.context?.featureKey;
  if (featureKey === undefined) throw new Error("A grant was decided without its feature.");
  const subject = await attributes.subject();
  if (subject === null) throw new Error("A grant was decided without a subject account.");
  const reasonCodes = attributes.judgeGrantChange.refusals(subject, {
    featureKey,
    quota: attributes.request.context?.quota ?? null,
    extendsGrantId: attributes.request.context?.extendsGrantId ?? null,
  });
  const finding: Finding = {
    source: "entitlement",
    outcome: reasonCodes.length === 0 ? "Allow" : "Deny",
    reasonCodes,
    sources: [],
    coveringTermSource: subject.effective.kind === "Effective" ? subject.effective.coveringTerm.source : null,
    facts: subject.effective.kind === "None" ? subject.effective.facts : {},
  };
  return { finding, stops: false };
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
    const context = attributes.request.context ?? {};
    const featureKey = featureKeyOf(attributes.request.actionKey) ?? context.featureKey ?? null;
    const durationDays = await attributes.daysGranted();
    const quota = (await attributes.quotaGranted()) ?? context.quota;
    const contactAccountId = attributes.request.contactAccountId ?? null;
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
          : principal.kind === "System"
            ? { account_id: principal.accountId, account_kind: "Internal", identity_kind: "System" }
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
        ...(quota === undefined ? {} : { quota }),
        ...(durationDays === null ? {} : { duration_days: durationDays }),
        has_contact: contactAccountId !== null,
        contact_authenticated: contactAccountId !== null && context.contactAuthenticated === true,
        approval_granted: context.approvalGranted === true,
        ...(context.requesterAccountId === undefined
          ? {}
          : { requester_account_id: context.requesterAccountId }),
        ...(context.confirmerAccountId === undefined
          ? {}
          : { confirmer_account_id: context.confirmerAccountId }),
      },
      environment: { now: attributes.now },
    };
  }
}

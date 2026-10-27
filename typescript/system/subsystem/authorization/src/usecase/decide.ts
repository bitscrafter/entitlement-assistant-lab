import type {
  AuthorizationDecider,
  Decision,
  DecisionRequest,
} from "../../../../port/authorization-decider.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { LoadPrincipalPermissions } from "../../../access/src/usecase/load-principal-permissions.ts";
import type { GetCustomerAccount } from "../../../account/src/usecase/get-customer-account.ts";
import type { LoadPrincipal } from "../../../account/src/usecase/load-principal.ts";
import type { CheckGrantEligibility } from "../../../entitlement/src/usecase/check-grant-eligibility.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type { CountGrantedTotals } from "../../../entitlement/src/usecase/count-granted-totals.ts";
import type { EvaluatePolicies } from "../../../policy/src/usecase/evaluate-policies.ts";
import type { GetCatalog } from "../../../product/src/usecase/get-catalog.ts";
import { combineFindings } from "./decision.ts";
import { DecisionAttributes } from "./decision-attributes.ts";
import {
  AccessStep,
  AccountStep,
  ContactAccessStep,
  type DecisionStep,
  EntitlementStep,
  PolicyStep,
} from "./decision-steps.ts";

/** The Policy Decision Point (AU-1, AU-5): the one place an authorization decision is made. */
export class Decide implements AuthorizationDecider {
  readonly #steps: readonly DecisionStep[];
  readonly #accessStep: AccessStep;
  readonly #evaluatePolicies: EvaluatePolicies;
  readonly #sources: {
    readonly loadPrincipal: LoadPrincipal;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly checkGrantEligibility: CheckGrantEligibility;
    readonly countGrantedTotals: CountGrantedTotals;
  };
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly loadPrincipal: LoadPrincipal;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly loadPrincipalPermissions: LoadPrincipalPermissions;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly checkGrantEligibility: CheckGrantEligibility;
    readonly countGrantedTotals: CountGrantedTotals;
    readonly evaluatePolicies: EvaluatePolicies;
    readonly getCatalog: GetCatalog;
    readonly clock: Clock;
  }) {
    this.#accessStep = new AccessStep(dependencies.loadPrincipalPermissions);
    this.#steps = [
      new AccountStep(),
      this.#accessStep,
      new ContactAccessStep(dependencies.loadPrincipalPermissions),
      new EntitlementStep(),
      new PolicyStep(dependencies.evaluatePolicies, dependencies.getCatalog),
    ];
    this.#evaluatePolicies = dependencies.evaluatePolicies;
    this.#sources = dependencies;
    this.#clock = dependencies.clock;
  }

  async decide(request: DecisionRequest): Promise<Decision> {
    const attributes = new DecisionAttributes(request, this.#clock.now(), this.#sources);
    const findings = [];
    for (const step of this.#steps) {
      const { finding, stops } = await step.decide(attributes);
      if (finding !== null) findings.push(finding);
      if (stops) break;
    }
    return combineFindings(findings, this.#evaluatePolicies.policySetVersion);
  }

  async decidePermission(request: Omit<DecisionRequest, "subjectAccountId">): Promise<Decision> {
    const attributes = new DecisionAttributes(
      { ...request, subjectAccountId: null },
      this.#clock.now(),
      this.#sources,
    );
    const { finding } = await this.#accessStep.decide(attributes);
    return combineFindings(finding === null ? [] : [finding], this.#evaluatePolicies.policySetVersion);
  }
}

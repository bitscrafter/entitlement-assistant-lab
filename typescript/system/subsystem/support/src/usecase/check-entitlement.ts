import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type {
  FindLowestPlanIncluding,
  Remedy,
} from "../../../product/src/usecase/find-lowest-plan-including.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import {
  type AccountContext,
  accountContextOf,
  type CoveringTerm,
  type EntitlementSource,
  type Quota,
  type ReadRefusal,
  type ReadRequest,
  type ReasonFacts,
} from "./read-request.ts";

export type CheckEntitlementResult =
  | {
      readonly kind: "Entitled";
      readonly account: AccountContext;
      readonly quota: Quota;
      readonly sources: readonly EntitlementSource[];
      readonly coveringTerm: CoveringTerm | null;
    }
  | {
      readonly kind: "NotEntitled";
      readonly account: AccountContext;
      readonly reasonCodes: readonly string[];
      readonly facts: ReasonFacts;
      /** What would include the feature, when its plan and add-ons do not (PR-10); null for any other reason. */
      readonly remedy: Remedy | null;
    }
  | ReadRefusal;

/** Whether a customer account is entitled to one feature, with every source, or why not (EN-6). */
export class CheckEntitlement {
  readonly #enforcement: ReadEnforcement;
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;
  readonly #findLowestPlanIncluding: FindLowestPlanIncluding;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly enforcement: ReadEnforcement;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly findLowestPlanIncluding: FindLowestPlanIncluding;
    readonly clock: Clock;
  }) {
    this.#enforcement = dependencies.enforcement;
    this.#computeEffectiveEntitlements = dependencies.computeEffectiveEntitlements;
    this.#findLowestPlanIncluding = dependencies.findLowestPlanIncluding;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Read through the enforcement template: gate, subject, one audited `account.read` decision (AU-4).
   * @ensures Entitled with the feature's quota, every source, and the covering term; otherwise every reason, with facts,
   *          and a remedy when the feature is not included.
   * @ensures Either way, the account's name, plan, and covering term, as a CSR recognizes the account.
   */
  async execute(
    request: ReadRequest & { readonly accountId: Uuid; readonly featureKey: string },
  ): Promise<CheckEntitlementResult> {
    return this.#enforcement.read(request, "CheckEntitlement", request.accountId, async () => {
      const computed = await this.#computeEffectiveEntitlements.execute({
        accountId: request.accountId,
        at: this.#clock.now(),
      });
      if (computed === null) return { kind: "NotFound" };
      const account = accountContextOf(computed);
      const effective = computed.effective;
      if (effective.kind === "None") {
        return {
          kind: "NotEntitled",
          account,
          reasonCodes: effective.reasonCodes,
          facts: effective.facts,
          remedy: null,
        };
      }
      const entitlement = effective.entitlements.find(
        (candidate) => candidate.featureKey === request.featureKey,
      );
      if (entitlement === undefined) {
        const remedy = await this.#findLowestPlanIncluding.execute({
          featureKey: request.featureKey,
          currentPlanKey: effective.coveringTerm.planKey,
        });
        return {
          kind: "NotEntitled",
          account,
          reasonCodes: ["entitlement.feature-not-included"],
          facts: {},
          remedy,
        };
      }
      return {
        kind: "Entitled",
        account,
        quota: entitlement.quota,
        sources: entitlement.sources,
        coveringTerm: effective.coveringTerm,
      };
    });
  }
}

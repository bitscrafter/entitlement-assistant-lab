import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import type {
  CoveringTerm,
  EntitlementSource,
  Quota,
  ReadRefusal,
  ReadRequest,
  ReasonFacts,
} from "./read-request.ts";

export type CheckEntitlementResult =
  | {
      readonly kind: "Entitled";
      readonly quota: Quota;
      readonly sources: readonly EntitlementSource[];
      readonly coveringTerm: CoveringTerm | null;
    }
  | { readonly kind: "NotEntitled"; readonly reasonCodes: readonly string[]; readonly facts: ReasonFacts }
  | ReadRefusal;

/** Whether a customer account is entitled to one feature, with every source, or why not (EN-6). */
export class CheckEntitlement {
  readonly #enforcement: ReadEnforcement;
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly enforcement: ReadEnforcement;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly clock: Clock;
  }) {
    this.#enforcement = dependencies.enforcement;
    this.#computeEffectiveEntitlements = dependencies.computeEffectiveEntitlements;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Read through the enforcement template: gate, subject, one audited `account.read` decision (AU-4).
   * @ensures Entitled with the feature's quota, every source, and the covering term; otherwise every reason, with facts.
   */
  async execute(
    request: ReadRequest & { readonly accountId: Uuid; readonly featureKey: string },
  ): Promise<CheckEntitlementResult> {
    return this.#enforcement.read(request, "CheckEntitlement", request.accountId, async () => {
      const computed = await this.#computeEffectiveEntitlements.execute({
        accountId: request.accountId,
        at: this.#clock.now(),
      });
      const effective = computed?.effective;
      if (effective === undefined) return { kind: "NotFound" };
      if (effective.kind === "None")
        return { kind: "NotEntitled", reasonCodes: effective.reasonCodes, facts: effective.facts };
      const entitlement = effective.entitlements.find(
        (candidate) => candidate.featureKey === request.featureKey,
      );
      if (entitlement === undefined) {
        return { kind: "NotEntitled", reasonCodes: ["entitlement.feature-not-included"], facts: {} };
      }
      return {
        kind: "Entitled",
        quota: entitlement.quota,
        sources: entitlement.sources,
        coveringTerm: effective.coveringTerm,
      };
    });
  }
}

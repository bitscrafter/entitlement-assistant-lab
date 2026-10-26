import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import type { EntitlementSource, Quota, ReadRefusal, ReadRequest, ReasonFacts } from "./read-request.ts";

export interface EntitlementEntry {
  readonly featureKey: string;
  readonly quota: Quota;
  readonly sources: readonly EntitlementSource[];
}

export type ListEntitlementsResult =
  | {
      readonly kind: "Listed";
      /** Ordered by feature key. */
      readonly entries: readonly EntitlementEntry[];
      /** Why nothing is effective; empty when there are entries. */
      readonly reasonCodes: readonly string[];
      readonly facts: ReasonFacts;
    }
  | ReadRefusal;

/** Every effective entitlement of a customer account, or why there is none (EN-6). */
export class ListEntitlements {
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
   * @ensures Every effective entitlement, ordered by feature key; with none, every reason and its facts.
   */
  async execute(request: ReadRequest & { readonly accountId: Uuid }): Promise<ListEntitlementsResult> {
    return this.#enforcement.read(request, "ListEntitlements", request.accountId, async () => {
      const computed = await this.#computeEffectiveEntitlements.execute({
        accountId: request.accountId,
        at: this.#clock.now(),
      });
      const effective = computed?.effective;
      if (effective === undefined) return { kind: "NotFound" };
      if (effective.kind === "None") {
        return { kind: "Listed", entries: [], reasonCodes: effective.reasonCodes, facts: effective.facts };
      }
      return {
        kind: "Listed",
        entries: effective.entitlements.map(({ featureKey, quota, sources }) => ({
          featureKey,
          quota,
          sources,
        })),
        reasonCodes: [],
        facts: {},
      };
    });
  }
}

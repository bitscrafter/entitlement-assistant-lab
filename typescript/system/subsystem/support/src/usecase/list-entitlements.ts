import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import {
  type AccountContext,
  accountContextOf,
  type EntitlementSource,
  type Quota,
  type ReadRefusal,
  type ReadRequest,
  type ReasonFacts,
} from "./read-request.ts";

export interface EntitlementEntry {
  readonly featureKey: string;
  readonly quota: Quota;
  readonly sources: readonly EntitlementSource[];
}

export type ListEntitlementsResult =
  | {
      readonly kind: "Listed";
      readonly account: AccountContext;
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
   * @ensures Either way, the account's name, plan, and covering term, as a CSR recognizes the account.
   */
  async execute(request: ReadRequest & { readonly accountId: Uuid }): Promise<ListEntitlementsResult> {
    return this.#enforcement.read(request, "ListEntitlements", request.accountId, async () => {
      const computed = await this.#computeEffectiveEntitlements.execute({
        accountId: request.accountId,
        at: this.#clock.now(),
      });
      if (computed === null) return { kind: "NotFound" };
      const account = accountContextOf(computed);
      const effective = computed.effective;
      if (effective.kind === "None") {
        return {
          kind: "Listed",
          account,
          entries: [],
          reasonCodes: effective.reasonCodes,
          facts: effective.facts,
        };
      }
      return {
        kind: "Listed",
        account,
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

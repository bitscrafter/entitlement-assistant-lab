import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EntitlementGrant } from "../model/effective-entitlements.ts";
import {
  type DiffOperation,
  diffHolds,
  entitlementDiff,
  entitlementDocument,
  NEW_GRANT_SOURCE,
} from "../model/entitlement-diff.ts";
import type { ComputeEffectiveEntitlements } from "./compute-effective-entitlements.ts";

export type { DiffOperation };

/** The grant change a diff assumes: a grant ended now, a grant added, or both (an extension). */
export interface AssumedGrantChange {
  readonly adding?: Omit<EntitlementGrant, "grantId">;
  readonly ending?: Uuid;
}

/** A grant id no grant has: the added grant's source before it exists. */
const NEW_GRANT_ID = "00000000-0000-7000-8000-00000000000a" as Uuid;

/** The entitlement diff of a change (SU-4). Internal: Support's change requests call it. */
export class EntitlementDiffs {
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;

  constructor(dependencies: { readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements }) {
    this.#computeEffectiveEntitlements = dependencies.computeEffectiveEntitlements;
  }

  /**
   * @ensures The RFC 6902 operations from the account's effective entitlements at `at` to those were the change
   *          made at `at`, the added grant's source named `grant:new`; nothing for an account that does not exist.
   */
  async diffOf(accountId: Uuid, at: Date, change: AssumedGrantChange): Promise<readonly DiffOperation[]> {
    const before = await this.#computeEffectiveEntitlements.execute({ accountId, at });
    const after = await this.#computeEffectiveEntitlements.execute({
      accountId,
      at,
      assuming: {
        ...(change.ending === undefined ? {} : { ending: change.ending }),
        ...(change.adding === undefined ? {} : { adding: { ...change.adding, grantId: NEW_GRANT_ID } }),
      },
    });
    if (before === null || after === null) return [];
    const rename = (name: string) => (name === `grant:${NEW_GRANT_ID}` ? NEW_GRANT_SOURCE : name);
    return entitlementDiff(
      entitlementDocument(before.effective),
      entitlementDocument(after.effective, rename),
    );
  }

  /** @ensures Whether the diff still applies to the account's effective entitlements at `at` (`diffHolds`). */
  async holds(accountId: Uuid, at: Date, diff: readonly DiffOperation[]): Promise<boolean> {
    const current = await this.#computeEffectiveEntitlements.execute({ accountId, at });
    return current !== null && diffHolds(diff, entitlementDocument(current.effective));
  }
}

import type { Uuid } from "../../../../kernel/identifier.ts";
import type { PolicySet } from "../model/policy.ts";

export interface PolicySetRepository {
  /** @ensures True exactly when the set has an activation that has not ended. */
  isActive(version: string): Promise<boolean>;

  /**
   * Records the set, unless a set with its version is recorded.
   *
   * @ensures A recorded set never changes (policy §8).
   */
  register(set: PolicySet, scmRevision: string, registeredBy: Uuid, at: Date): Promise<void>;

  /** @ensures The set is active from `at`, unless it already is. */
  activate(version: string, activationId: Uuid, activatedBy: Uuid, at: Date): Promise<void>;
}

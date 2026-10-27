import type { Uuid } from "../../../../kernel/identifier.ts";

import { type HoldReason, holdReasonCodes } from "./hold.ts";

export type { HoldReason };

/** The employee a session acts for, loaded fresh for every request (CM-16). */
export interface EmployeePrincipal {
  readonly accountId: Uuid;
  readonly accountDisplayName: string;
  readonly internalIdentityId: Uuid;
  readonly departmentKey: string;
  readonly jobFunctionKey: string;
  readonly jobLevel: number;
}

/**
 * Why an account may not act: one reason code per unreleased hold, and the identity's status.
 *
 * @ensures Empty exactly when the account has no unreleased hold and its identity is active.
 * @ensures Reason codes are unique and sorted.
 */
export function principalRefusalReasons(
  holds: readonly HoldReason[],
  identityActive: boolean,
): readonly string[] {
  return holdReasonCodes(identityActive ? holds : [...holds, "InternalIdentityInactive"]);
}

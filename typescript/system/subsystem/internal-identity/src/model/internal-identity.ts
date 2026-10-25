import type { Uuid } from "../../../../kernel/identifier.ts";

export type IdentityStatus = "Active" | "Suspended" | "Terminated";

/** The job attributes birthright access and policies use (internal-identity data model). */
export interface EmployeeProfile {
  readonly internalIdentityId: Uuid;
  readonly identityStatus: IdentityStatus;
  readonly departmentKey: string;
  readonly jobFunctionKey: string;
  readonly jobLevel: number;
}

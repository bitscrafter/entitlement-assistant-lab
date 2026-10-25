import type { NormalizedEmail } from "../../../../kernel/email.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EmployeeProfile, IdentityStatus } from "../model/internal-identity.ts";

export interface CurrentPasswordCredential {
  readonly internalIdentityId: Uuid;
  readonly identityStatus: IdentityStatus;
  readonly passwordHash: string;
}

/** Reads employees and their credentials. */
export interface EmployeeRepository {
  /** @ensures The employee's current `Password` credential, or null when no employee has the email. */
  findCurrentPasswordCredential(email: NormalizedEmail): Promise<CurrentPasswordCredential | null>;

  /** @ensures The employee's profile, or null when the identity is not an employee. */
  findProfile(internalIdentityId: Uuid): Promise<EmployeeProfile | null>;
}

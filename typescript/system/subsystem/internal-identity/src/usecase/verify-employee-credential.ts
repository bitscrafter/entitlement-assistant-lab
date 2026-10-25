import type { NormalizedEmail } from "../../../../kernel/email.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import { failure, type Result, success } from "../../../../kernel/result.ts";
import type { IdentityStatus } from "../model/internal-identity.ts";
import type { EmployeeRepository } from "./employee-repository.ts";
import type { PasswordHasher } from "./password-hasher.ts";

export interface VerifiedEmployee {
  readonly internalIdentityId: Uuid;
  readonly identityStatus: IdentityStatus;
}

/**
 * Checks an employee's password. Whether the identity may act is the caller's decision.
 *
 * @ensures Succeeds only when an employee has `email` and `password` matches their current credential.
 * @ensures The same password derivation runs whether or not the email exists (timing reveals nothing).
 */
export class VerifyEmployeeCredential {
  readonly #employees: EmployeeRepository;
  readonly #hasher: PasswordHasher;

  constructor(dependencies: { readonly employees: EmployeeRepository; readonly hasher: PasswordHasher }) {
    this.#employees = dependencies.employees;
    this.#hasher = dependencies.hasher;
  }

  async execute(
    email: NormalizedEmail,
    password: string,
  ): Promise<Result<VerifiedEmployee, "InvalidCredentials">> {
    const credential = await this.#employees.findCurrentPasswordCredential(email);
    const matches = await this.#hasher.verify(password, credential?.passwordHash ?? null);
    if (credential === null || !matches) return failure("InvalidCredentials");
    return success({
      internalIdentityId: credential.internalIdentityId,
      identityStatus: credential.identityStatus,
    });
  }
}

import { ABSENT_UUID, type Uuid } from "../../../../kernel/identifier.ts";
import { failure, type Result, success } from "../../../../kernel/result.ts";
import type { GetEmployeeProfile } from "../../../internal-identity/src/usecase/get-employee-profile.ts";
import { type EmployeePrincipal, principalRefusalReasons } from "../model/principal.ts";

export type { EmployeePrincipal };

import type { InternalAccountRepository } from "./internal-account-repository.ts";

export type PrincipalRefusal =
  | { readonly kind: "UnknownAccount" }
  | { readonly kind: "MayNotAct"; readonly reasons: readonly string[] };

/**
 * Loads the employee a session acts for, from the database, never from token claims (rule principal-loaded-fresh).
 *
 * @ensures Succeeds only for an employee's internal account with no unreleased hold and an active identity.
 * @ensures A refusal of an existing account carries its reason codes.
 * @ensures The same queries run whether or not the account exists, so timing does not tell them apart.
 */
export class LoadPrincipal {
  readonly #accounts: InternalAccountRepository;
  readonly #getEmployeeProfile: GetEmployeeProfile;

  constructor(dependencies: {
    readonly accounts: InternalAccountRepository;
    readonly getEmployeeProfile: GetEmployeeProfile;
  }) {
    this.#accounts = dependencies.accounts;
    this.#getEmployeeProfile = dependencies.getEmployeeProfile;
  }

  async execute(accountId: Uuid): Promise<Result<EmployeePrincipal, PrincipalRefusal>> {
    const account = await this.#accounts.findById(accountId);
    const profile = await this.#getEmployeeProfile.execute(account?.internalIdentityId ?? ABSENT_UUID);
    const holds = await this.#accounts.unreleasedHolds(accountId);
    if (account === null || account.identityKind !== "Employee" || profile === null) {
      return failure({ kind: "UnknownAccount" });
    }
    const reasons = principalRefusalReasons(holds, profile.identityStatus === "Active");
    if (reasons.length > 0) return failure({ kind: "MayNotAct", reasons });
    return success({
      accountId,
      accountDisplayName: account.accountDisplayName,
      internalIdentityId: account.internalIdentityId,
      departmentKey: profile.departmentKey,
      jobFunctionKey: profile.jobFunctionKey,
      jobLevel: profile.jobLevel,
    });
  }

  /**
   * Loads a system identity's account for a decision (grants-and-approvals D8, D10).
   *
   * @ensures Succeeds only for a system identity's internal account with no unreleased hold.
   */
  async system(accountId: Uuid): Promise<Result<{ readonly accountId: Uuid }, PrincipalRefusal>> {
    const account = await this.#accounts.findById(accountId);
    if (account === null || account.identityKind !== "System") return failure({ kind: "UnknownAccount" });
    const holds = await this.#accounts.unreleasedHolds(accountId);
    const reasons = principalRefusalReasons(holds, true);
    if (reasons.length > 0) return failure({ kind: "MayNotAct", reasons });
    return success({ accountId });
  }

  /** @ensures The account of the system identity with this name, or null (grants-and-approvals D8, D10). */
  systemAccountIdNamed(name: string): Promise<Uuid | null> {
    return this.#accounts.systemAccountIdNamed(name);
  }
}

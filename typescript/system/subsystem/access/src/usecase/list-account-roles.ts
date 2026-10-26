import type { Clock } from "../../../../port/clock.ts";
import type { AccountRoleAssignment, AccountRoleFilter, RoleRepository } from "./role-repository.ts";

export type { AccountRoleAssignment };

/** Who holds which role in which customer account, now (account role assignments, access §4). */
export class ListAccountRoles {
  readonly #roles: RoleRepository;
  readonly #clock: Clock;

  constructor(dependencies: { readonly roles: RoleRepository; readonly clock: Clock }) {
    this.#roles = dependencies.roles;
    this.#clock = dependencies.clock;
  }

  /** @ensures The assignments not ended, of the member and/or in the account given. */
  async execute(filter: AccountRoleFilter): Promise<readonly AccountRoleAssignment[]> {
    return this.#roles.accountRoleAssignments(filter, this.#clock.now());
  }
}

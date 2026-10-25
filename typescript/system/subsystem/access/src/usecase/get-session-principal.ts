import type { Clock } from "../../../../port/clock.ts";
import type { EmployeePrincipal } from "../../../account/src/usecase/load-principal.ts";
import type { RoleRepository } from "./role-repository.ts";

export interface SessionPrincipal extends EmployeePrincipal {
  readonly roles: readonly string[];
}

/**
 * Who the session acts for, with the roles they hold now: the answer to "who am I" (api.md §4).
 *
 * @requires `principal` was loaded fresh for this request by Account's `LoadPrincipal`.
 * @ensures Roles are loaded fresh, never from the token (rule principal-loaded-fresh).
 */
export class GetSessionPrincipal {
  readonly #roles: RoleRepository;
  readonly #clock: Clock;

  constructor(dependencies: { readonly roles: RoleRepository; readonly clock: Clock }) {
    this.#roles = dependencies.roles;
    this.#clock = dependencies.clock;
  }

  async execute(principal: EmployeePrincipal): Promise<SessionPrincipal> {
    return { ...principal, roles: await this.#roles.employeeRoles(principal, this.#clock.now()) };
  }
}

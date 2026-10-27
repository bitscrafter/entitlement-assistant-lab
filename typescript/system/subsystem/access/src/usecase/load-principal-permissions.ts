import type { Uuid } from "../../../../kernel/identifier.ts";
import type { GetCustomerAccount } from "../../../account/src/usecase/get-customer-account.ts";
import type { HasActiveMembership } from "../../../customer-identity/src/usecase/has-active-membership.ts";
import type { EmployeeJobAttributes, RoleRepository } from "./role-repository.ts";

/** Each permission a principal holds, with the roles that grant it; empty roles for a direct assignment only. */
export type PermissionHoldings = ReadonlyMap<string, readonly string[]>;

export type PermissionPrincipal =
  | { readonly kind: "Employee"; readonly employee: EmployeeJobAttributes }
  | { readonly kind: "Individual"; readonly accountId: Uuid; readonly contextAccountId: Uuid }
  | { readonly kind: "System"; readonly accountId: Uuid };

/**
 * A principal's effective permissions, computed fresh by one building block (access §5). Internal: the Policy
 * Information Point calls it (AU-5).
 */
export class LoadPrincipalPermissions {
  readonly #roles: RoleRepository;
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #hasActiveMembership: HasActiveMembership;

  constructor(dependencies: {
    readonly roles: RoleRepository;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly hasActiveMembership: HasActiveMembership;
  }) {
    this.#roles = dependencies.roles;
    this.#getCustomerAccount = dependencies.getCustomerAccount;
    this.#hasActiveMembership = dependencies.hasActiveMembership;
  }

  /**
   * @ensures An employee holds the permissions of their birthright and internal roles, and their direct assignments.
   * @ensures A system identity holds the permissions of the roles assigned to its account.
   * @ensures An individual holds, in the context account, the permissions of their active role assignments there,
   *          counting only assignments justified by the same account or an active membership in the organization
   *          that owns it (access §6).
   * @ensures Each permission lists the roles granting it, sorted; nothing is held by omission (AU-3).
   */
  async execute(principal: PermissionPrincipal, now: Date): Promise<PermissionHoldings> {
    if (principal.kind === "Employee") {
      const roles = await this.#roles.employeeRoles(principal.employee, now);
      const holdings = await this.#holdingsOf(roles);
      for (const permission of await this.#roles.internalPermissions(principal.employee.accountId, now)) {
        if (!holdings.has(permission)) holdings.set(permission, []);
      }
      return holdings;
    }
    if (principal.kind === "System")
      return this.#holdingsOf(await this.#roles.systemRoles(principal.accountId, now));
    const assignments = await this.#roles.accountRoleAssignments(
      { memberAccountId: principal.accountId, memberOfAccountId: principal.contextAccountId },
      now,
    );
    if (
      assignments.length === 0 ||
      !(await this.#justified(principal.accountId, principal.contextAccountId, now))
    ) {
      return new Map();
    }
    return this.#holdingsOf(assignments.map((assignment) => assignment.roleKey));
  }

  async #holdingsOf(roleKeys: readonly string[]): Promise<Map<string, string[]>> {
    const holdings = new Map<string, string[]>();
    for (const [role, permissions] of await this.#roles.rolePermissions(roleKeys)) {
      for (const permission of permissions)
        holdings.set(permission, [...(holdings.get(permission) ?? []), role].sort());
    }
    return holdings;
  }

  async #justified(memberAccountId: Uuid, contextAccountId: Uuid, now: Date): Promise<boolean> {
    if (memberAccountId === contextAccountId) return true;
    const member = await this.#getCustomerAccount.execute(memberAccountId);
    const context = await this.#getCustomerAccount.execute(contextAccountId);
    if (member === null || context === null || context.customerKind !== "Organization") return false;
    return this.#hasActiveMembership.execute({
      individualId: member.customerId,
      organizationId: context.customerId,
      at: now,
    });
  }
}

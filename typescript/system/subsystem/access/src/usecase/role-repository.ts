import type { Uuid } from "../../../../kernel/identifier.ts";

export interface EmployeeJobAttributes {
  readonly accountId: Uuid;
  readonly departmentKey: string;
  readonly jobFunctionKey: string;
  readonly jobLevel: number;
}

export interface RoleRepository {
  /**
   * @ensures The roles the employee holds at `now`: birthright roles matching their department, job function,
   *          and level, and internal role assignments not ended and not expired; each role once, sorted.
   */
  employeeRoles(employee: EmployeeJobAttributes, now: Date): Promise<readonly string[]>;

  /** @ensures Each role's permissions, for every role among `roleKeys`. */
  rolePermissions(roleKeys: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;

  /** @ensures The permissions directly assigned to the internal account, not ended and not expired at `now`. */
  internalPermissions(accountId: Uuid, now: Date): Promise<readonly string[]>;

  /**
   * @ensures The account role assignments not ended by `now`, of the member and/or in the account given; at least
   *          one of the two is given.
   */
  accountRoleAssignments(filter: AccountRoleFilter, now: Date): Promise<readonly AccountRoleAssignment[]>;
}

export type AccountRoleFilter =
  | { readonly memberAccountId: Uuid; readonly memberOfAccountId?: Uuid }
  | { readonly memberAccountId?: Uuid; readonly memberOfAccountId: Uuid };

export interface AccountRoleAssignment {
  readonly memberAccountId: Uuid;
  readonly memberOfAccountId: Uuid;
  readonly roleKey: string;
}

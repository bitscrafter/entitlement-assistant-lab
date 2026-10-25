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
}

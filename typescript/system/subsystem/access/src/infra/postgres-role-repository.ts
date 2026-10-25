import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { EmployeeJobAttributes, RoleRepository } from "../usecase/role-repository.ts";

export class PostgresRoleRepository implements RoleRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async employeeRoles(employee: EmployeeJobAttributes, now: Date): Promise<readonly string[]> {
    const rows = await this.#connection.query<{ role_key: string }>(
      `SELECT role_key FROM birthright_role_assignment
        WHERE department_key = $1 AND job_function_key = $2 AND minimum_job_level <= $3
       UNION
       SELECT role_key FROM internal_role_assignment
        WHERE internal_account_id = $4 AND ended_at IS NULL AND (expires_at IS NULL OR expires_at > $5)
       ORDER BY role_key`,
      [employee.departmentKey, employee.jobFunctionKey, employee.jobLevel, employee.accountId, now],
    );
    return rows.map((row) => row.role_key);
  }
}

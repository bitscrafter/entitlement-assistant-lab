import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type {
  AccountRoleAssignment,
  AccountRoleFilter,
  EmployeeJobAttributes,
  RoleRepository,
} from "../usecase/role-repository.ts";

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

  async rolePermissions(roleKeys: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    const rows = await this.#connection.query<{ role_key: string; permissions: string[] }>(
      `SELECT role_key, array_agg(permission_key ORDER BY permission_key) AS permissions
         FROM role_permission WHERE role_key = ANY($1::text[]) GROUP BY role_key`,
      [roleKeys],
    );
    return new Map(rows.map((row) => [row.role_key, row.permissions]));
  }

  async internalPermissions(accountId: Uuid, now: Date): Promise<readonly string[]> {
    const rows = await this.#connection.query<{ permission_key: string }>(
      `SELECT permission_key FROM internal_permission_assignment
        WHERE internal_account_id = $1 AND ended_at IS NULL AND expires_at > $2 ORDER BY permission_key`,
      [accountId, now],
    );
    return rows.map((row) => row.permission_key);
  }

  async accountRoleAssignments(
    filter: AccountRoleFilter,
    now: Date,
  ): Promise<readonly AccountRoleAssignment[]> {
    const rows = await this.#connection.query<{
      member_account_id: Uuid;
      member_of_account_id: Uuid;
      role_key: string;
    }>(
      `SELECT member_account_id, member_of_account_id, role_key FROM account_role_assignment
        WHERE ($1::uuid IS NULL OR member_account_id = $1) AND ($2::uuid IS NULL OR member_of_account_id = $2)
          AND assigned_at <= $3 AND (ended_at IS NULL OR ended_at > $3)
        ORDER BY member_of_account_id, member_account_id, role_key`,
      [filter.memberAccountId ?? null, filter.memberOfAccountId ?? null, now],
    );
    return rows.map((row) => ({
      memberAccountId: row.member_account_id,
      memberOfAccountId: row.member_of_account_id,
      roleKey: row.role_key,
    }));
  }
}

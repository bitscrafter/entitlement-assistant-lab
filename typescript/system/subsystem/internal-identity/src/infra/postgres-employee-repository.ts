import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { NormalizedEmail } from "../../../../kernel/email.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EmployeeProfile, IdentityStatus } from "../model/internal-identity.ts";
import type { CurrentPasswordCredential, EmployeeRepository } from "../usecase/employee-repository.ts";

export class PostgresEmployeeRepository implements EmployeeRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  /**
   * @relies-on db: employee_email_unique
   * @relies-on db: employee_credential_one_current_per_kind
   */
  async findCurrentPasswordCredential(email: NormalizedEmail): Promise<CurrentPasswordCredential | null> {
    const [row] = await this.#connection.query<{ id: string; status: IdentityStatus; password_hash: string }>(
      `SELECT i.internal_identity_id AS id, i.identity_status AS status, c.password_hash
         FROM employee e
         JOIN internal_identity i USING (internal_identity_id)
         JOIN employee_credential c ON c.employee_id = e.internal_identity_id
        WHERE e.email = $1 AND c.credential_kind = 'Password' AND c.replaced_at IS NULL`,
      [email],
    );
    return row === undefined
      ? null
      : { internalIdentityId: row.id as Uuid, identityStatus: row.status, passwordHash: row.password_hash };
  }

  async findProfile(internalIdentityId: Uuid): Promise<EmployeeProfile | null> {
    const [row] = await this.#connection.query<{
      status: IdentityStatus;
      department_key: string;
      job_function_key: string;
      job_level: number;
    }>(
      `SELECT i.identity_status AS status, e.department_key, e.job_function_key, e.job_level
         FROM employee e JOIN internal_identity i USING (internal_identity_id)
        WHERE e.internal_identity_id = $1`,
      [internalIdentityId],
    );
    return row === undefined
      ? null
      : {
          internalIdentityId,
          identityStatus: row.status,
          departmentKey: row.department_key,
          jobFunctionKey: row.job_function_key,
          jobLevel: row.job_level,
        };
  }
}

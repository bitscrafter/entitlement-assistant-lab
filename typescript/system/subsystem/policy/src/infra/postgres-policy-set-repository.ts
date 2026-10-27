import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { PolicySet } from "../model/policy.ts";
import type { PolicySetRepository } from "../usecase/policy-set-repository.ts";

export class PostgresPolicySetRepository implements PolicySetRepository {
  readonly #connection: PostgresConnection;

  constructor(connection: PostgresConnection) {
    this.#connection = connection;
  }

  async isActive(version: string): Promise<boolean> {
    const rows = await this.#connection.query(
      "SELECT 1 FROM policy_set_activation WHERE policy_set_version = $1 AND ended_at IS NULL",
      [version],
    );
    return rows.length > 0;
  }

  /** @relies-on db: policy_set primary key (a version is recorded once) */
  async register(set: PolicySet, scmRevision: string, registeredBy: Uuid, at: Date): Promise<void> {
    const inserted = await this.#connection.query(
      `INSERT INTO policy_set (policy_set_version, scm_revision, registered_at, registered_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT (policy_set_version) DO NOTHING RETURNING 1`,
      [set.version, scmRevision, at, registeredBy],
    );
    if (inserted.length === 0) return;
    for (const policy of set.policies) {
      await this.#connection.query(
        `INSERT INTO policy (policy_set_version, policy_key, description, applies_when, requires, unmet_outcome)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          set.version,
          policy.policyKey,
          policy.description,
          policy.appliesWhen,
          policy.requires,
          policy.unmetOutcome,
        ],
      );
      for (const action of policy.governedActions) {
        await this.#connection.query(
          "INSERT INTO policy_governed_action (policy_set_version, policy_key, action_key) VALUES ($1, $2, $3)",
          [set.version, policy.policyKey, action],
        );
      }
      for (const prerequisite of policy.prerequisites) {
        await this.#connection.query(
          `INSERT INTO policy_prerequisite (policy_set_version, policy_key, prerequisite_kind, fulfilled_by_permission)
           VALUES ($1, $2, $3, $4)`,
          [set.version, policy.policyKey, prerequisite.prerequisiteKind, prerequisite.fulfilledByPermission],
        );
      }
    }
  }

  async activate(version: string, activationId: Uuid, activatedBy: Uuid, at: Date): Promise<void> {
    if (await this.isActive(version)) return;
    await this.#connection.query(
      `INSERT INTO policy_set_activation (activation_id, policy_set_version, activated_at, activated_by)
       VALUES ($1, $2, $3, $4)`,
      [activationId, version, at, activatedBy],
    );
  }
}

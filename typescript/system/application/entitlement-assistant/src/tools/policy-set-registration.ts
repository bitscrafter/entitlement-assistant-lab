import { execFileSync } from "node:child_process";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { PostgresPolicySetRepository } from "../../../../subsystem/policy/src/infra/postgres-policy-set-repository.ts";
import { seededUuid } from "../database/seed.ts";
import { loadBundledPolicySet } from "../policy-set.ts";

/**
 * Registers the bundled policy set and activates it, recorded as `sys_deployment` (policy §6). Run as the database
 * owner, before the Worker that bundles the set is deployed; an earlier set stays active until it is ended.
 *
 * @returns The set's version and the git revision recorded with it.
 */
export async function registerBundledPolicySet(
  connectionString: string,
): Promise<{ readonly version: string; readonly revision: string }> {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const set = await loadBundledPolicySet();
  const connection = await PostgresConnection.open(connectionString);
  try {
    const policySets = new PostgresPolicySetRepository(connection);
    const deployment = seededUuid("iac_sys_deployment");
    const now = new Date();
    await policySets.register(set, revision, deployment, now);
    await policySets.activate(set.version, crypto.randomUUID() as never, deployment, now);
    return { version: set.version, revision };
  } finally {
    await connection.close();
  }
}

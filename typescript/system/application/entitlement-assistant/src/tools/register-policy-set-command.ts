import { execFileSync } from "node:child_process";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { PostgresPolicySetRepository } from "../../../../subsystem/policy/src/infra/postgres-policy-set-repository.ts";
import { seededUuid } from "../database/seed.ts";
import { loadBundledPolicySet } from "../policy-set.ts";

/**
 * Registers the bundled policy set and activates it, recorded as `sys_deployment` (policy §6). Run as the database
 * owner, before the Worker that bundles the set is deployed; an earlier set stays active until it is ended.
 */
const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const set = await loadBundledPolicySet();
const connection = await PostgresConnection.open(connectionString);
try {
  const policySets = new PostgresPolicySetRepository(connection);
  const deployment = seededUuid("iac_sys_deployment");
  const now = new Date();
  await policySets.register(set, revision, deployment, now);
  await policySets.activate(set.version, crypto.randomUUID() as never, deployment, now);
  console.log(`Policy set ${set.version} registered and active (revision ${revision}).`);
} finally {
  await connection.close();
}

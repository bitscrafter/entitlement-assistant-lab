import { readFile } from "node:fs/promises";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { migrate } from "../database/migrate.ts";
import { seed } from "../database/seed.ts";
import { parseSeedPasswords } from "../database/seed-passwords.ts";
import { registerBundledPolicySet } from "./policy-set-registration.ts";

/**
 * Returns the demo database to its starting state in one step: drops every table, migrates, seeds with the
 * passwords file and today's fixture day, and registers the bundled policy set. Everything in the database is lost:
 * cases, grants, approvals, audit records. Run before a demo:
 *
 *   DATABASE_URL=… SEED_PASSWORDS_FILE=.env.seed-passwords npm run demo:reset -- --yes
 */
const connectionString = process.env.DATABASE_URL;
const passwordsFile = process.env.SEED_PASSWORDS_FILE;
if (connectionString === undefined || passwordsFile === undefined) {
  console.error("DATABASE_URL and SEED_PASSWORDS_FILE are required.");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error("This deletes everything in the database. Run it again with --yes to go ahead.");
  process.exit(1);
}
const passwords = parseSeedPasswords(await readFile(passwordsFile, "utf8"));

const owner = await PostgresConnection.open(connectionString);
try {
  await owner.query("DROP SCHEMA public CASCADE");
  await owner.query("CREATE SCHEMA public");
} finally {
  await owner.close();
}
const applied = await migrate(connectionString);
const fixtureDay = new Date().toISOString().slice(0, 10);
const aliases = await seed(connectionString, { passwords, fixtureDay });
const { version, revision } = await registerBundledPolicySet(connectionString);
console.log(
  `Reset: ${applied.length} migrations, ${aliases.size} seeded identifiers (fixture day ${fixtureDay}), policy set ${version} active (revision ${revision}).`,
);

import {
  connectionStringFor,
  TEMPLATE_DATABASE,
  withAdminClient,
} from "../../../../adapter/tests/support/database.ts";
import { migrate } from "../../src/database/migrate.ts";
import { seed } from "../../src/database/seed.ts";

/** Builds the template every test database is cloned from: migrated, then seeded. */
export default async function setup(): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DATABASE} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  });
  await migrate(connectionStringFor(TEMPLATE_DATABASE));
  await seed(connectionStringFor(TEMPLATE_DATABASE));
}

import { randomUUID } from "node:crypto";
import { PostgresClient } from "../../../external/postgres.ts";

export const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:local-development-only@localhost:54329/entitlement_agent";

export const TEMPLATE_DATABASE = "entitlement_agent_template";

export function connectionStringFor(database: string): string {
  const url = new URL(ADMIN_CONNECTION_STRING);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function withAdminClient<Result>(
  work: (client: PostgresClient) => Promise<Result>,
): Promise<Result> {
  const client = new PostgresClient({ connectionString: ADMIN_CONNECTION_STRING });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  readonly connectionString: string;
  readonly drop: () => Promise<void>;
}

/** A database cloned from the migrated and seeded template, private to one test. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `entitlement_agent_test_${randomUUID().replaceAll("-", "")}`;
  await withAdminClient((client) => client.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`));
  return {
    connectionString: connectionStringFor(name),
    drop: () =>
      withAdminClient(async (client) => void (await client.query(`DROP DATABASE ${name} WITH (FORCE)`))),
  };
}

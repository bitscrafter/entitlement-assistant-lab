import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import { SUBSYSTEMS_IN_LAYER_ORDER } from "../../src/database/migrate.ts";

/** Layer of each subsystem, bottom first (CM-15). Subsystems sharing a number sit on the same layer. */
const LAYER: Readonly<Record<string, number>> = {
  "customer-identity": 0,
  "internal-identity": 0,
  account: 1,
  product: 2,
  access: 3,
  entitlement: 4,
  policy: 5,
  authorization: 6,
  support: 7,
};

const SYSTEM_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

async function tableOwners(): Promise<ReadonlyMap<string, string>> {
  const owners = new Map<string, string>();
  for (const subsystem of SUBSYSTEMS_IN_LAYER_ORDER) {
    const directory = `${SYSTEM_ROOT}subsystem/${subsystem}/src/infra/migrations/`;
    for (const fileName of await readdir(directory)) {
      const sql = await readFile(`${directory}${fileName}`, "utf8");
      for (const match of sql.matchAll(/CREATE TABLE (\w+)/g)) {
        if (match[1] !== undefined) owners.set(match[1], subsystem);
      }
    }
  }
  return owners;
}

describe("rule foreign-keys-point-downward", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;

  beforeAll(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
  });

  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  test("invariant every foreign key points to the same or a lower layer, and attribution references nothing outside itself", async () => {
    const owners = await tableOwners();
    const foreignKeys = await connection.query<{
      constraint_name: string;
      from_table: string;
      to_table: string;
    }>(
      `SELECT conname AS constraint_name, conrelid::regclass::text AS from_table, confrelid::regclass::text AS to_table
         FROM pg_constraint WHERE contype = 'f'`,
    );
    expect(foreignKeys.length).toBeGreaterThan(0);
    const violations = foreignKeys.filter(({ from_table, to_table }) => {
      const from = owners.get(from_table);
      const to = owners.get(to_table);
      if (from === undefined || to === undefined) return true;
      if (from === "attribution") return to !== "attribution";
      return (LAYER[to] ?? Number.POSITIVE_INFINITY) > (LAYER[from] ?? Number.NEGATIVE_INFINITY);
    });
    expect(violations).toEqual([]);
  });
});

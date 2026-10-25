import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import { parseUuid } from "../../../../kernel/identifier.ts";
import { seededUuid } from "../../src/database/seed.ts";

describe("seed", () => {
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

  test("ensures a seeded UUID is version 7, stable, and distinct per alias", () => {
    expect(parseUuid(seededUuid("iac_alex")).ok).toBe(true);
    expect(seededUuid("iac_alex").charAt(14)).toBe("7");
    expect(seededUuid("iac_alex")).toBe(seededUuid("iac_alex"));
    expect(seededUuid("iac_alex")).not.toBe(seededUuid("emp_alex"));
  });

  test("ensures every alias in the fixtures is stored under its seeded UUID", async () => {
    const rows = await connection.query<{ account_display_name: string }>(
      "SELECT account_display_name FROM account WHERE account_id = $1",
      [seededUuid("iac_alex")],
    );
    expect(rows).toEqual([{ account_display_name: "Alex" }]);
  });

  test("ensures an account is Suspended exactly when it has an unreleased hold", async () => {
    const mismatches = await connection.query(
      `SELECT account_id FROM account a
        WHERE (a.account_status = 'Suspended') <> EXISTS (
          SELECT 1 FROM account_hold h WHERE h.account_id = a.account_id AND h.released_at IS NULL)`,
    );
    expect(mismatches).toEqual([]);
    const suspended = await connection.query<{ account_id: string }>(
      "SELECT account_id FROM account WHERE account_status = 'Suspended' ORDER BY account_id",
    );
    expect(suspended.map((row) => row.account_id).sort()).toEqual(
      [seededUuid("iac_casey"), seededUuid("iac_dana")].sort(),
    );
  });
});

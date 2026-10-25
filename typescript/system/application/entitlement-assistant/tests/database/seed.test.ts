import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import {
  connectionStringFor,
  createTestDatabase,
  type TestDatabase,
  withAdminClient,
} from "../../../../adapter/tests/support/database.ts";
import { parseUuid } from "../../../../kernel/identifier.ts";
import { WebCryptoPasswordHasher } from "../../../../subsystem/internal-identity/src/infra/web-crypto-password-hasher.ts";
import { migrate } from "../../src/database/migrate.ts";
import { readSeedEmployees, seed, seededUuid } from "../../src/database/seed.ts";

async function passwordHashOf(connection: PostgresConnection, email: string): Promise<string> {
  const rows = await connection.query<{ password_hash: string }>(
    `SELECT c.password_hash FROM employee_credential c JOIN employee e ON e.internal_identity_id = c.employee_id
      WHERE e.email = $1`,
    [email],
  );
  return rows[0]?.password_hash ?? "";
}

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

  test("ensures each credential verifies the fixture's demo password when no seed passwords are given", async () => {
    const hasher = new WebCryptoPasswordHasher();
    expect(
      await hasher.verify("alex-demo-password", await passwordHashOf(connection, "alex@provider.example")),
    ).toBe(true);
  });

  test("requires seed passwords for a database that is not local", async () => {
    await expect(seed("postgres://user:secret@database.example/entitlement_assistant")).rejects.toThrow(
      /SEED_PASSWORDS_FILE/,
    );
  });

  test("requires seed passwords to name every fixture employee", async () => {
    await expect(
      seed(database.connectionString, new Map([["alex@provider.example", "alex-k7m2-x9qp-4hdr"]])),
    ).rejects.toThrow(/missing for blair@provider\.example/);
  });

  test("ensures each credential verifies its seed password, not the demo password, when seed passwords are given", async () => {
    const name = `entitlement_assistant_seed_${Date.now()}`;
    await withAdminClient((client) => client.query(`CREATE DATABASE ${name}`));
    try {
      await migrate(connectionStringFor(name));
      const employees = await readSeedEmployees();
      const passwords = new Map(
        employees.map((employee) => [employee.email, `${employee.given_name}-k7m2-x9qp`]),
      );
      await seed(connectionStringFor(name), passwords);
      const seeded = await PostgresConnection.open(connectionStringFor(name));
      try {
        const hasher = new WebCryptoPasswordHasher();
        for (const employee of employees) {
          const passwordHash = await passwordHashOf(seeded, employee.email);
          expect(await hasher.verify(`${employee.given_name}-k7m2-x9qp`, passwordHash)).toBe(true);
          expect(
            await hasher.verify(`${employee.given_name.toLowerCase()}-demo-password`, passwordHash),
          ).toBe(false);
        }
      } finally {
        await seeded.close();
      }
    } finally {
      await withAdminClient(
        async (client) => void (await client.query(`DROP DATABASE ${name} WITH (FORCE)`)),
      );
    }
  });
});

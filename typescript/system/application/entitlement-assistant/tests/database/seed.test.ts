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
import { fixtureInstantShifter, readSeedEmployees, seed, seededUuid } from "../../src/database/seed.ts";

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
      [
        seededUuid("iac_casey"),
        seededUuid("iac_dana"),
        seededUuid("acc_umbrella"),
        seededUuid("acc_dan"),
      ].sort(),
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
      seed(database.connectionString, {
        passwords: new Map([["alex@provider.example", "alex-k7m2-x9qp-4hdr"]]),
      }),
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
      await seed(connectionStringFor(name), { passwords });
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

  test("ensures without a fixture day every instant is unchanged", () => {
    expect(fixtureInstantShifter()("2026-10-22T15:00:00.000Z")).toBe("2026-10-22T15:00:00.000Z");
  });

  test.each([
    ["a later day", "2026-11-05", "2026-11-05T15:00:00.000Z", "2026-10-15T00:00:00.000Z"],
    ["an earlier day", "2026-10-20", "2026-10-20T15:00:00.000Z", "2026-09-29T00:00:00.000Z"],
    ["the reference day", "2026-10-22", "2026-10-22T15:00:00.000Z", "2026-10-01T00:00:00.000Z"],
  ])("ensures with %s every instant moves by the whole days to it", (_name, day, instant, termStart) => {
    const shift = fixtureInstantShifter(day);
    expect(shift("2026-10-22T15:00:00Z")).toBe(instant);
    expect(shift("2026-10-01T00:00:00Z")).toBe(termStart);
  });

  test("requires the fixture day to be a calendar day", () => {
    expect(() => fixtureInstantShifter("2026-11-05T00:00:00Z")).toThrow(/YYYY-MM-DD/);
  });

  test("ensures every fixture instant is moved by the fixture day when seeding", async () => {
    const name = `entitlement_assistant_shift_${Date.now()}`;
    await withAdminClient((client) => client.query(`CREATE DATABASE ${name}`));
    try {
      await migrate(connectionStringFor(name));
      await seed(connectionStringFor(name), { fixtureDay: "2026-11-05" });
      const seeded = await PostgresConnection.open(connectionStringFor(name));
      try {
        const rows = await seeded.query<{ starts_at: Date; scheduled_end_at: Date; placed_at: Date }>(
          `SELECT t.starts_at, t.scheduled_end_at,
                  (SELECT placed_at FROM account_hold WHERE account_id = $2) AS placed_at
             FROM subscription_term t WHERE t.term_id = $1`,
          [seededUuid("trm_acme_1"), seededUuid("acc_umbrella")],
        );
        expect(
          rows.map((row) => [row.starts_at, row.scheduled_end_at, row.placed_at].map((d) => d.toISOString())),
        ).toEqual([["2026-10-15T00:00:00.000Z", "2026-11-15T00:00:00.000Z", "2026-11-03T10:00:00.000Z"]]);
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

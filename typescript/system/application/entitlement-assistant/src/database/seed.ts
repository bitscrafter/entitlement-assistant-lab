import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { PostgresClient } from "../../../../external/postgres.ts";
import { parseYaml } from "../../../../external/yaml.ts";
import { z } from "../../../../external/zod.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import { WebCryptoPasswordHasher } from "../../../../subsystem/internal-identity/src/infra/web-crypto-password-hasher.ts";
import { PostgresPolicySetRepository } from "../../../../subsystem/policy/src/infra/postgres-policy-set-repository.ts";
import { loadBundledPolicySet } from "../policy-set.ts";
import { catalogSchema, customerFixturesSchema, insertCatalog, insertCustomers } from "./seed-customers.ts";
import { isLocalDatabase, type SeedPasswords } from "./seed-passwords.ts";

const SEED_DIRECTORY = fileURLToPath(new URL("../../resource/seed/", import.meta.url));
const SEED_EPOCH_MILLISECONDS = Date.parse("2026-10-01T00:00:00Z");

const key = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const alias = z.string().regex(/^[a-z]+_[a-z0-9_]+$/);
const instant = z.iso.datetime();

const referenceDataSchema = z.strictObject({
  departments: z.array(z.strictObject({ department: key, name: z.string() })),
  job_functions: z.array(z.strictObject({ job_function: key, name: z.string() })),
  resource_operations: z.array(
    z.strictObject({
      permission: z.string().regex(/^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/),
      held_by: z.enum(["Individual", "Employee", "System"]),
      description: z.string(),
    }),
  ),
  roles: z.array(
    z.strictObject({
      role: key,
      principal_kind: z.enum(["Individual", "Employee", "System"]),
      name: z.string(),
      description: z.string(),
      permissions: z.array(z.string()),
    }),
  ),
  birthright_role_assignments: z.array(
    z.strictObject({ department: key, job_function: key, minimum_job_level: z.int().positive(), role: key }),
  ),
  catalog: catalogSchema,
});

const holdSchema = z.strictObject({
  reason: z.enum([
    "OperationalSuspension",
    "CustomerRemoved",
    "NoActiveMembership",
    "InternalIdentityInactive",
  ]),
  placed_at: instant,
  placed_by: alias,
});

const fixturesSchema = z.strictObject({
  seeded_at: instant,
  system_identities: z.array(
    z.strictObject({
      identity: alias,
      account: alias,
      name: key,
      description: z.string(),
      roles: z.array(key),
    }),
  ),
  employees: z.array(
    z.strictObject({
      identity: alias,
      account: alias,
      status: z.enum(["Active", "Suspended", "Terminated"]),
      email: z.email(),
      given_name: z.string(),
      family_name: z.string(),
      display_name: z.string(),
      department: key,
      job_function: key,
      job_level: z.int().positive(),
      password: z.string().min(1),
      holds: z.array(holdSchema).optional(),
    }),
  ),
  ...customerFixturesSchema,
});

/** The seeded aliases (`emp_alex`, `iac_alex`) and the UUIDs they stand for. */
export type SeedAliases = ReadonlyMap<string, Uuid>;

/**
 * A UUIDv7 derived from an alias, identical on every run, so that fixtures and tests agree on ids.
 *
 * @ensures Version 7 and the RFC 9562 variant; distinct aliases give distinct UUIDs.
 */
export function seededUuid(name: string): Uuid {
  const digest = createHash("sha256").update(name).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  let milliseconds = SEED_EPOCH_MILLISECONDS;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = milliseconds % 256;
    milliseconds = Math.floor(milliseconds / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}

async function readSeedFile<Schema extends z.ZodType>(
  fileName: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  return schema.parse(parseYaml(await readFile(`${SEED_DIRECTORY}${fileName}`, "utf8")));
}

/**
 * Every action key the reference data defines: resource permissions and feature permissions (access §2).
 *
 * @ensures `<resource_type>.<operation>` for each resource operation, and `feature.<feature_key>.<operation>` for each
 *          feature operation of the catalog.
 */
export async function readActionKeys(): Promise<ReadonlySet<string>> {
  const reference = await readSeedFile("reference-data.yaml", referenceDataSchema);
  return new Set([
    ...reference.resource_operations.map((operation) => operation.permission),
    ...reference.catalog.features.flatMap((feature) =>
      (feature.operations ?? []).map((operation) => `feature.${feature.feature}.${operation.operation}`),
    ),
  ]);
}

/** The fixture employees a seed password is created for. */
export async function readSeedEmployees(): Promise<
  readonly { readonly email: string; readonly given_name: string }[]
> {
  return (await readSeedFile("fixtures.yaml", fixturesSchema)).employees;
}

/**
 * Chooses the password each fixture employee is seeded with.
 *
 * @requires `passwords` is given unless the database is local, and then names every fixture employee.
 * @ensures With `passwords`, each employee gets the password under its email; without, the fixture's demo password.
 */
function choosePasswords(
  connectionString: string,
  employees: readonly { readonly email: string; readonly password: string }[],
  passwords: SeedPasswords | undefined,
): (email: string) => string {
  if (passwords === undefined) {
    if (!isLocalDatabase(connectionString)) {
      throw new Error(
        "A database that is not local is seeded only with seed passwords (SEED_PASSWORDS_FILE).",
      );
    }
    const demoPasswords = new Map(employees.map((employee) => [employee.email, employee.password]));
    return (email) => demoPasswords.get(email) ?? "";
  }
  const missing = employees.filter((employee) => !passwords.has(employee.email));
  if (missing.length > 0) {
    throw new Error(
      `Seed passwords are missing for ${missing.map((employee) => employee.email).join(", ")}.`,
    );
  }
  return (email) => passwords.get(email) ?? "";
}

/** The day of the specs' fixed instant (explain-access D7); fixture instants are written relative to it. */
const FIXTURE_REFERENCE_DAY = "2026-10-22";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Moves fixture instants so that the reference day falls on `fixtureDay`, keeping every interval.
 *
 * @requires `fixtureDay`, when given, is a calendar day `YYYY-MM-DD`.
 * @ensures Without `fixtureDay`, every instant is returned unchanged.
 * @ensures With it, every instant moves by the whole days between the reference day and `fixtureDay`.
 */
export function fixtureInstantShifter(fixtureDay?: string): (instant: string) => string {
  if (fixtureDay === undefined) return (instant) => instant;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fixtureDay))
    throw new Error("The fixture day is a calendar day, YYYY-MM-DD.");
  const days = Math.round(
    (Date.parse(`${fixtureDay}T00:00:00Z`) - Date.parse(`${FIXTURE_REFERENCE_DAY}T00:00:00Z`)) /
      MILLISECONDS_PER_DAY,
  );
  return (instant) => new Date(Date.parse(instant) + days * MILLISECONDS_PER_DAY).toISOString();
}

export interface SeedOptions {
  /** Replaces the published demo passwords; required for a database that is not local. */
  readonly passwords?: SeedPasswords;
  /** Moves the fixture so that the specs' reference day (2026-10-22) falls on this day. */
  readonly fixtureDay?: string;
}

/**
 * Loads reference data and fixtures straight into the tables, in one transaction. Seeding bypasses the use
 * cases and writes no audit records (production-readiness, migration ordering).
 *
 * @requires `options.passwords` is given unless the database is local, and then names every fixture employee.
 * @ensures Every alias in the fixtures maps to its `seededUuid`.
 * @ensures An account is `Suspended` exactly when it has an unreleased hold.
 * @ensures Each employee's credential verifies its seed password when `passwords` is given, else the fixture's.
 * @ensures Every fixture instant is moved by `fixtureInstantShifter(options.fixtureDay)`.
 * @ensures The bundled policy set is registered and active.
 */
export async function seed(connectionString: string, options: SeedOptions = {}): Promise<SeedAliases> {
  const reference = await readSeedFile("reference-data.yaml", referenceDataSchema);
  const fixtures = await readSeedFile("fixtures.yaml", fixturesSchema);
  const passwordOf = choosePasswords(connectionString, fixtures.employees, options.passwords);
  const instantOf = fixtureInstantShifter(options.fixtureDay);
  const hasher = new WebCryptoPasswordHasher();
  const aliases = new Map<string, Uuid>();
  const idOf = (name: string): Uuid => {
    const existing = aliases.get(name);
    if (existing !== undefined) return existing;
    const created = seededUuid(name);
    aliases.set(name, created);
    return created;
  };
  const client = new PostgresClient({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const department of reference.departments) {
      await client.query("INSERT INTO department (department_key, name) VALUES ($1, $2)", [
        department.department,
        department.name,
      ]);
    }
    for (const jobFunction of reference.job_functions) {
      await client.query("INSERT INTO job_function (job_function_key, name) VALUES ($1, $2)", [
        jobFunction.job_function,
        jobFunction.name,
      ]);
    }
    for (const resourceOperation of reference.resource_operations) {
      const [resourceType, operation] = resourceOperation.permission.split(".");
      await client.query(
        "INSERT INTO resource_operation (resource_type, operation, description) VALUES ($1, $2, $3)",
        [resourceType, operation, resourceOperation.description],
      );
      await client.query(
        `INSERT INTO permission (permission_key, principal_kind, operation, resource_type, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          resourceOperation.permission,
          resourceOperation.held_by,
          operation,
          resourceType,
          resourceOperation.description,
        ],
      );
    }
    await insertCatalog(client, reference.catalog);
    for (const role of reference.roles) {
      await client.query(
        "INSERT INTO role (role_key, principal_kind, name, description) VALUES ($1, $2, $3, $4)",
        [role.role, role.principal_kind, role.name, role.description],
      );
      for (const permission of role.permissions) {
        await client.query(
          "INSERT INTO role_permission (role_key, permission_key, principal_kind) VALUES ($1, $2, $3)",
          [role.role, permission, role.principal_kind],
        );
      }
    }
    for (const birthright of reference.birthright_role_assignments) {
      await client.query(
        `INSERT INTO birthright_role_assignment (department_key, job_function_key, minimum_job_level, role_key)
         VALUES ($1, $2, $3, $4)`,
        [birthright.department, birthright.job_function, birthright.minimum_job_level, birthright.role],
      );
    }

    const seededAt = instantOf(fixtures.seeded_at);
    const insertInternalIdentity = async (
      identity: string,
      account: string,
      kind: "Employee" | "System",
      status: string,
      displayName: string,
      suspended: boolean,
    ) => {
      await client.query(
        `INSERT INTO internal_identity (internal_identity_id, identity_kind, identity_status, created_at)
         VALUES ($1, $2, $3, $4)`,
        [idOf(identity), kind, status, seededAt],
      );
      await client.query(
        `INSERT INTO account (account_id, account_kind, account_display_name, account_status, created_at)
         VALUES ($1, 'Internal', $2, $3, $4)`,
        [idOf(account), displayName, suspended ? "Suspended" : "Active", seededAt],
      );
      return async () => {
        await client.query(
          `INSERT INTO internal_account (account_id, internal_identity_id, identity_kind) VALUES ($1, $2, $3)`,
          [idOf(account), idOf(identity), kind],
        );
      };
    };

    const linkAccounts: Array<() => Promise<void>> = [];
    for (const system of fixtures.system_identities) {
      linkAccounts.push(
        await insertInternalIdentity(system.identity, system.account, "System", "Active", system.name, false),
      );
      await client.query(
        "INSERT INTO system_identity (internal_identity_id, name, description) VALUES ($1, $2, $3)",
        [idOf(system.identity), system.name, system.description],
      );
    }
    for (const employee of fixtures.employees) {
      const suspended = (employee.holds ?? []).length > 0;
      linkAccounts.push(
        await insertInternalIdentity(
          employee.identity,
          employee.account,
          "Employee",
          employee.status,
          employee.display_name,
          suspended,
        ),
      );
      await client.query(
        `INSERT INTO employee (internal_identity_id, department_key, job_function_key, email, given_name,
                               family_name, job_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          idOf(employee.identity),
          employee.department,
          employee.job_function,
          employee.email,
          employee.given_name,
          employee.family_name,
          employee.job_level,
        ],
      );
      await client.query(
        `INSERT INTO employee_credential (credential_id, employee_id, credential_kind, password_hash, created_at)
         VALUES ($1, $2, 'Password', $3, $4)`,
        [
          idOf(`crd_${employee.identity}`),
          idOf(employee.identity),
          await hasher.hash(passwordOf(employee.email)),
          seededAt,
        ],
      );
    }
    for (const link of linkAccounts) await link();

    for (const system of fixtures.system_identities) {
      for (const role of system.roles) {
        await client.query(
          `INSERT INTO internal_role_assignment (assignment_id, internal_account_id, role_key, principal_kind,
                                                 reason, assigned_at, assigned_by)
           VALUES ($1, $2, $3, 'System', 'Seeded system role', $4, $2)`,
          [idOf(`ira_${system.account}_${role}`), idOf(system.account), role, seededAt],
        );
      }
    }
    for (const employee of fixtures.employees) {
      for (const [index, hold] of (employee.holds ?? []).entries()) {
        await client.query(
          `INSERT INTO account_hold (hold_id, account_id, hold_reason, placed_at, placed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            idOf(`hld_${employee.account}_${index}`),
            idOf(employee.account),
            hold.reason,
            instantOf(hold.placed_at),
            idOf(hold.placed_by),
          ],
        );
      }
    }
    await insertCustomers(client, fixtures, idOf, instantOf, seededAt);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  await registerBundledPolicySet(connectionString, instantOf(fixtures.seeded_at));
  return aliases;
}

/** Registers and activates the bundled policy set as the seed's deployment (policy §6), by iac_sam. */
async function registerBundledPolicySet(connectionString: string, at: string): Promise<void> {
  const connection = await PostgresConnection.open(connectionString);
  try {
    const policySets = new PostgresPolicySetRepository(connection);
    const set = await loadBundledPolicySet();
    await policySets.register(set, "seed", seededUuid("iac_sam"), new Date(at));
    await policySets.activate(
      set.version,
      seededUuid("act_seeded_policy_set"),
      seededUuid("iac_sam"),
      new Date(at),
    );
  } finally {
    await connection.close();
  }
}

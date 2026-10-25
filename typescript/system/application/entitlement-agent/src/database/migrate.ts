import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PostgresClient } from "../../../../external/postgres.ts";

/** Subsystems whose migrations run, bottom of the layer order first (CM-15). */
export const SUBSYSTEMS_IN_LAYER_ORDER = ["internal-identity", "account", "access", "attribution"] as const;

const SYSTEM_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MIGRATION_LOCK_KEY = 72_101;

/**
 * Applies the application's migrations, then every subsystem's, in layer order and file-name order.
 *
 * @ensures Each migration file is applied at most once, recorded in `schema_migration`.
 * @ensures Migrations of a lower layer are applied before those of a higher layer.
 * @returns The migrations applied by this call, as `<subsystem>/<file>`.
 */
export async function migrate(connectionString: string): Promise<readonly string[]> {
  const client = new PostgresClient({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migration (
         subsystem text NOT NULL,
         file_name text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (subsystem, file_name)
       )`,
    );
    const applied: string[] = [];
    const owners = [
      {
        owner: "application",
        directory: `${SYSTEM_ROOT}application/entitlement-agent/src/database/migrations/`,
      },
      ...SUBSYSTEMS_IN_LAYER_ORDER.map((subsystem) => ({
        owner: subsystem,
        directory: `${SYSTEM_ROOT}subsystem/${subsystem}/src/infra/migrations/`,
      })),
    ];
    for (const { owner: subsystem, directory } of owners) {
      const fileNames = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
      for (const fileName of fileNames) {
        const existing = await client.query(
          "SELECT 1 FROM schema_migration WHERE subsystem = $1 AND file_name = $2",
          [subsystem, fileName],
        );
        if (existing.rowCount !== 0) continue;
        const sql = await readFile(`${directory}${fileName}`, "utf8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migration (subsystem, file_name) VALUES ($1, $2)", [
            subsystem,
            fileName,
          ]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
        applied.push(`${subsystem}/${fileName}`);
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    await client.end();
  }
}

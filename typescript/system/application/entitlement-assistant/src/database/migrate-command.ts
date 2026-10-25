import { migrate } from "./migrate.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const applied = await migrate(connectionString);
console.log(applied.length === 0 ? "No pending migrations." : applied.join("\n"));

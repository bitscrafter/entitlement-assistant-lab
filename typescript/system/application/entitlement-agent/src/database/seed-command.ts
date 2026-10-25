import { seed } from "./seed.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const aliases = await seed(connectionString);
console.log(`Seeded ${aliases.size} identifiers.`);

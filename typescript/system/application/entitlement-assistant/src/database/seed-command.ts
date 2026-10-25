import { readFile } from "node:fs/promises";
import { seed } from "./seed.ts";
import { parseSeedPasswords } from "./seed-passwords.ts";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const passwordsFile = process.env.SEED_PASSWORDS_FILE;
const passwords =
  passwordsFile === undefined ? undefined : parseSeedPasswords(await readFile(passwordsFile, "utf8"));
const aliases = await seed(connectionString, passwords);
console.log(
  `Seeded ${aliases.size} identifiers${passwords === undefined ? " with the demo passwords" : ""}.`,
);

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { readSeedEmployees } from "../database/seed.ts";
import { createSeedPassword, formatSeedPasswords } from "../database/seed-passwords.ts";

/** Writes a fresh password per fixture employee to .env.seed-passwords (git-ignored), for seeding a deployed database. */
const target = new URL("../../../../.env.seed-passwords", import.meta.url);
if (existsSync(target)) {
  console.error(".env.seed-passwords already exists; delete it to create new passwords.");
  process.exit(1);
}
const employees = await readSeedEmployees();
const passwords = new Map(
  employees.map((employee) => [
    employee.email,
    createSeedPassword(employee.given_name, (length) => crypto.getRandomValues(new Uint8Array(length))),
  ]),
);
await writeFile(target, formatSeedPasswords(passwords), { mode: 0o600 });
console.log(`Wrote .env.seed-passwords for ${passwords.size} employees.`);

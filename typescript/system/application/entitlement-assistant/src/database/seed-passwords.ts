/**
 * Passwords that replace the fixtures' published demo passwords, by employee email. The repository is public,
 * so any database reachable from outside this machine is seeded with these instead.
 */
export type SeedPasswords = ReadonlyMap<string, string>;

/** Letters and digits that cannot be misread for one another (no 0/o, 1/l/i). */
const READABLE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const RANDOM_CHARACTER_COUNT = 12;
const GROUP_LENGTH = 4;
/** The largest multiple of the alphabet size below 256; bytes at or above it are skipped, so every character is equally likely. */
const UNBIASED_BYTE_LIMIT = 256 - (256 % READABLE_ALPHABET.length);

/**
 * Whether a connection string names a database on this machine, the only place the published demo passwords
 * may be seeded.
 *
 * @ensures True exactly when the host is `localhost`, `127.0.0.1`, or `::1`.
 */
export function isLocalDatabase(connectionString: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname);
}

/**
 * A password that is easy to read and type: the employee's given name, then 12 random characters in groups
 * of four (`alex-k7m2-x9qp-4hdr`, about 59 bits of entropy).
 *
 * @requires `randomBytes` returns cryptographically random bytes of the requested length.
 * @ensures The result is the lowercase given name followed by three groups of four characters from the readable alphabet.
 * @ensures Each random character is drawn uniformly from the readable alphabet.
 */
export function createSeedPassword(givenName: string, randomBytes: (length: number) => Uint8Array): string {
  let characters = "";
  while (characters.length < RANDOM_CHARACTER_COUNT) {
    for (const byte of randomBytes(RANDOM_CHARACTER_COUNT)) {
      if (byte < UNBIASED_BYTE_LIMIT && characters.length < RANDOM_CHARACTER_COUNT) {
        characters += READABLE_ALPHABET.charAt(byte % READABLE_ALPHABET.length);
      }
    }
  }
  const groups = characters.match(new RegExp(`.{${GROUP_LENGTH}}`, "g")) ?? [];
  return [givenName.toLowerCase(), ...groups].join("-");
}

/**
 * Writes seed passwords as `email=password` lines, the format `parseSeedPasswords` reads.
 *
 * @ensures `parseSeedPasswords(formatSeedPasswords(passwords))` equals `passwords`.
 */
export function formatSeedPasswords(passwords: SeedPasswords): string {
  return `${Array.from(passwords, ([email, password]) => `${email}=${password}`).join("\n")}\n`;
}

/**
 * Reads `email=password` lines; blank lines and lines starting with `#` are skipped.
 *
 * @ensures Every other line yields one entry, split at its first `=`.
 * @ensures A line without `=`, with an empty side, or repeating an email is rejected with its line number.
 */
export function parseSeedPasswords(text: string): SeedPasswords {
  const passwords = new Map<string, string>();
  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    const email = trimmed.slice(0, Math.max(separator, 0));
    const password = trimmed.slice(separator + 1);
    if (separator <= 0 || password === "" || passwords.has(email)) {
      throw new Error(`Seed passwords line ${index + 1} is not a new email=password entry.`);
    }
    passwords.set(email, password);
  }
  return passwords;
}

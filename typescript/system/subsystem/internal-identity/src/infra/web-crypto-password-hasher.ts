import type { PasswordHasher } from "../usecase/password-hasher.ts";

/** Workers' WebCrypto caps PBKDF2 at 100,000 iterations (architect plan §5). */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PHC_PATTERN = /^\$pbkdf2-sha256\$i=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
const UNKNOWN_IDENTITY_SALT = new Uint8Array(SALT_BYTES);

/** PBKDF2-SHA256 through WebCrypto, available in Workers and Node alike. */
export class WebCryptoPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await derive(password, salt, PBKDF2_ITERATIONS);
    return `$pbkdf2-sha256$i=${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
  }

  async verify(password: string, passwordHash: string | null): Promise<boolean> {
    const parsed = passwordHash === null ? null : parse(passwordHash);
    if (parsed === null) {
      await derive(password, UNKNOWN_IDENTITY_SALT, PBKDF2_ITERATIONS);
      return false;
    }
    const derived = await derive(password, parsed.salt, parsed.iterations);
    return constantTimeEqual(derived, parsed.hash);
  }
}

interface ParsedHash {
  readonly iterations: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
}

function parse(passwordHash: string): ParsedHash | null {
  const match = PHC_PATTERN.exec(passwordHash);
  if (match === null) return null;
  const [, iterations, salt, hash] = match;
  if (iterations === undefined || salt === undefined || hash === undefined) return null;
  const count = Number.parseInt(iterations, 10);
  if (count < 1 || count > PBKDF2_ITERATIONS) return null;
  return { iterations: count, salt: fromBase64(salt), hash: fromBase64(hash) };
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt), iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
}

function fromBase64(text: string): Uint8Array {
  const padded = text.padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

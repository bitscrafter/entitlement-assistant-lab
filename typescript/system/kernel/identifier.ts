import type { Brand } from "./brand.ts";
import { failure, type Result, success } from "./result.ts";

/** A UUID in canonical lowercase form, as stored in PostgreSQL's `uuid` columns (CM-14). */
export type Uuid = Brand<string, "Uuid">;

/** Every kind prefix an identifier may be shown with (data-model README, id prefix register). */
export const IDENTIFIER_PREFIXES = [
  "cus",
  "mbr",
  "emp",
  "sys",
  "crd",
  "acc",
  "iac",
  "hld",
  "ara",
  "ira",
  "ipa",
  "sub",
  "trm",
  "sad",
  "grt",
  "cse",
  "asg",
  "chg",
  "apr",
  "act",
  "aud",
  "ses",
  "jti",
] as const;

export type IdentifierPrefix = (typeof IDENTIFIER_PREFIXES)[number];

/** A UUID no entity ever has; queries made with it find nothing, so every path can run the same queries. */
export const ABSENT_UUID = "00000000-0000-7000-8000-000000000000" as Uuid;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENCODED_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Accepts a UUID in canonical form.
 *
 * @ensures The result is lowercase, hyphenated, 36 characters long.
 */
export function parseUuid(text: string): Result<Uuid, "MalformedUuid"> {
  const lowercase = text.toLowerCase();
  return UUID_PATTERN.test(lowercase) ? success(lowercase as Uuid) : failure("MalformedUuid");
}

/**
 * Shows a UUID externally: its kind prefix, an underscore, and the 16 bytes as unpadded base64url.
 *
 * @ensures The result is the prefix, "_", and exactly 22 characters.
 * @ensures `decodeIdentifier(prefix, encodeIdentifier(prefix, uuid))` returns `uuid`.
 */
export function encodeIdentifier(prefix: IdentifierPrefix, uuid: Uuid): string {
  const bytes = new Uint8Array(16);
  const hex = uuid.replaceAll("-", "");
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return `${prefix}_${toBase64Url(bytes)}`;
}

/**
 * Reads an externally shown identifier of an expected kind.
 *
 * @ensures A well-formed identifier with another prefix is `MalformedIdentifier`, like any other malformed text.
 * @ensures Only the canonical spelling is accepted: decoding then encoding returns the input.
 */
export function decodeIdentifier(
  prefix: IdentifierPrefix,
  text: string,
): Result<Uuid, "MalformedIdentifier"> {
  const expectedStart = `${prefix}_`;
  if (!text.startsWith(expectedStart)) return failure("MalformedIdentifier");
  const encoded = text.slice(expectedStart.length);
  if (!ENCODED_PATTERN.test(encoded)) return failure("MalformedIdentifier");
  const bytes = fromBase64Url(encoded);
  if (bytes.length !== 16) return failure("MalformedIdentifier");
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonical = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const uuid = canonical as Uuid;
  // A 22-character encoding carries 4 spare bits; only the canonical spelling is accepted, so one id has one form.
  return encodeIdentifier(prefix, uuid) === text ? success(uuid) : failure("MalformedIdentifier");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += ALPHABET.charAt((buffer >> bits) & 63);
    }
  }
  if (bits > 0) output += ALPHABET.charAt((buffer << (6 - bits)) & 63);
  return output;
}

export function fromBase64Url(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) return new Uint8Array(0);
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}

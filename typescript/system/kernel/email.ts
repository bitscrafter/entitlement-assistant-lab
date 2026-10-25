import type { Brand } from "./brand.ts";

/** An email address in the one stored form (CM-10). */
export type NormalizedEmail = Brand<string, "NormalizedEmail">;

/**
 * The single normalization of email addresses (CM-10).
 *
 * @ensures Surrounding whitespace removed, Unicode NFC, lowercase, domain in ASCII (punycode).
 * @ensures No provider-specific rewriting: dots and plus tags are kept.
 * @ensures Text without exactly one "@" separating two non-empty parts is returned lowercase and trimmed,
 *          so that it matches no stored address.
 */
export function normalizeEmail(text: string): NormalizedEmail {
  const lowered = text.trim().normalize("NFC").toLowerCase();
  const separator = lowered.lastIndexOf("@");
  if (separator <= 0 || separator === lowered.length - 1 || lowered.indexOf("@") !== separator) {
    return lowered as NormalizedEmail;
  }
  const local = lowered.slice(0, separator);
  const domain = lowered.slice(separator + 1);
  let asciiDomain = domain;
  try {
    asciiDomain = new URL(`http://${domain}`).hostname;
  } catch {
    asciiDomain = domain;
  }
  return `${local}@${asciiDomain}` as NormalizedEmail;
}

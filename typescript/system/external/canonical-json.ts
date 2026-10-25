/** RFC 8785 JSON canonicalization, reachable only through this module (rule dependencies-point-inward). */
import canonicalize from "canonicalize";

export function canonicalJson(value: unknown): string {
  const text = canonicalize(value);
  if (text === undefined) throw new Error("Value has no canonical JSON form.");
  return text;
}

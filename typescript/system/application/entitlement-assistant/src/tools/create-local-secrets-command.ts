import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { toBase64Url } from "../../../../kernel/identifier.ts";

/** Writes fresh local secrets to .dev.vars for `wrangler dev`; production secrets are set with `wrangler secret put`. */
const target = new URL("../../../../.dev.vars", import.meta.url);
if (existsSync(target)) {
  console.error(".dev.vars already exists; delete it to create new secrets.");
  process.exit(1);
}
const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const randomKey = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
await writeFile(
  target,
  [
    `APPLICATION_ORIGIN="http://localhost:8787"`,
    `SESSION_SIGNING_KEY='${JSON.stringify(jwk)}'`,
    `SESSION_SIGNING_KEY_ID="local-session-key"`,
    `AUDIT_HASH_KEY="${randomKey()}"`,
    `AUDIT_HASH_KEY_ID="local-audit-key"`,
    `IDENTIFIER_HASH_KEY="${randomKey()}"`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log("Wrote .dev.vars");

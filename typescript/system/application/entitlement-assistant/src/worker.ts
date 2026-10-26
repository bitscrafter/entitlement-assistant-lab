import type { webcrypto } from "node:crypto";
import { SystemClock } from "../../../adapter/clock/system-clock.ts";
import { UuidVersion7Generator } from "../../../adapter/identifier/uuid-version7-generator.ts";
import { PostgresConnection } from "../../../adapter/postgres/postgres-connection.ts";
import { ConsoleSecurityEventLog } from "../../../adapter/security-event-log/console-security-event-log.ts";
import { importHashKey } from "../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import { type Application, createApplication } from "./application.ts";
import { httpsRedirect, servedByApplication } from "./http/request-guard.ts";
import { errorResponse } from "./http/responses.ts";
import { loadBundledPolicySet } from "./policy-set.ts";

/** Bindings and secrets declared in wrangler.jsonc and set with `wrangler secret put` (or .dev.vars locally). */
interface Environment {
  readonly ASSETS: { readonly fetch: (request: Request) => Promise<Response> };
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly APPLICATION_ORIGIN: string;
  readonly SESSION_SIGNING_KEY: string;
  readonly SESSION_SIGNING_KEY_ID: string;
  readonly AUDIT_HASH_KEY: string;
  readonly AUDIT_HASH_KEY_ID: string;
  readonly IDENTIFIER_HASH_KEY: string;
}

let application: Promise<Application> | undefined;

/**
 * Imports the session signing key pair from the private JWK in the Worker secret.
 *
 * @ensures The private half signs and the public half verifies ES256 tokens; neither can be exported.
 */
export async function importSessionSigningKey(
  privateJwkText: string,
): Promise<{ readonly privateKey: CryptoKey; readonly publicKey: CryptoKey }> {
  // key_ops and ext describe the exported key, not the uses imported here; each half gets its own usage.
  const {
    key_ops: _operations,
    ext: _extractable,
    ...privateJwk
  } = JSON.parse(privateJwkText) as webcrypto.JsonWebKey;
  const { d: _privateComponent, ...publicJwk } = privateJwk;
  const curve = { name: "ECDSA", namedCurve: "P-256" } as const;
  return {
    privateKey: await crypto.subtle.importKey("jwk", privateJwk, curve, false, ["sign"]),
    publicKey: await crypto.subtle.importKey("jwk", publicJwk, curve, false, ["verify"]),
  };
}

/** Builds the application once per isolate: keys are imported once, a database connection is opened per request. */
async function build(environment: Environment): Promise<Application> {
  return createApplication({
    applicationOrigin: environment.APPLICATION_ORIGIN,
    openDatabase: () => PostgresConnection.open(environment.HYPERDRIVE.connectionString),
    clock: new SystemClock(),
    idGenerator: new UuidVersion7Generator(),
    securityEventLog: new ConsoleSecurityEventLog(),
    sessionSigningKey: {
      keyId: environment.SESSION_SIGNING_KEY_ID,
      ...(await importSessionSigningKey(environment.SESSION_SIGNING_KEY)),
    },
    auditHashKey: {
      keyId: environment.AUDIT_HASH_KEY_ID,
      key: await importHashKey(environment.AUDIT_HASH_KEY),
    },
    identifierHashKey: await importHashKey(environment.IDENTIFIER_HASH_KEY),
    policySet: await loadBundledPolicySet(),
    forwardToCaseAgent: async () => errorResponse("not_found"),
  });
}

export default {
  /** Every request reaches the Worker first (`run_worker_first`), so plain HTTP is redirected before any page is served. */
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const redirect = httpsRedirect(request, environment.APPLICATION_ORIGIN);
    if (redirect !== undefined) return redirect;
    if (!servedByApplication(new URL(request.url).pathname)) return environment.ASSETS.fetch(request);
    application ??= build(environment);
    try {
      return await (await application).fetch(request);
    } catch (error) {
      // A failed start is not cached: the next request builds again. Nothing about the failure is returned.
      application = undefined;
      console.error(JSON.stringify({ log: "application-start-failed", message: String(error) }));
      return errorResponse("server_error");
    }
  },
};

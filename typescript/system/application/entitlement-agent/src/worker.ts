import type { webcrypto } from "node:crypto";
import { SystemClock } from "../../../adapter/clock/system-clock.ts";
import { UuidVersion7Generator } from "../../../adapter/identifier/uuid-version7-generator.ts";
import { PostgresConnection } from "../../../adapter/postgres/postgres-connection.ts";
import { ConsoleSecurityEventLog } from "../../../adapter/security-event-log/console-security-event-log.ts";
import { importHashKey } from "../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import { type Application, createApplication } from "./application.ts";
import { errorResponse } from "./http/responses.ts";

/** Bindings and secrets declared in wrangler.jsonc and set with `wrangler secret put` (or .dev.vars locally). */
interface Environment {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly APPLICATION_ORIGIN: string;
  readonly SESSION_SIGNING_KEY: string;
  readonly SESSION_SIGNING_KEY_ID: string;
  readonly AUDIT_HASH_KEY: string;
  readonly AUDIT_HASH_KEY_ID: string;
  readonly IDENTIFIER_HASH_KEY: string;
}

let application: Promise<Application> | undefined;

/** Builds the application once per isolate: keys are imported once, a database connection is opened per request. */
async function build(environment: Environment): Promise<Application> {
  // key_ops and ext describe the exported key, not the uses imported here; each half gets its own usage.
  const {
    key_ops: _operations,
    ext: _extractable,
    ...privateJwk
  } = JSON.parse(environment.SESSION_SIGNING_KEY) as webcrypto.JsonWebKey;
  const { d: _privateComponent, ...publicJwk } = privateJwk;
  const curve = { name: "ECDSA", namedCurve: "P-256" } as const;
  return createApplication({
    applicationOrigin: environment.APPLICATION_ORIGIN,
    openDatabase: () => PostgresConnection.open(environment.HYPERDRIVE.connectionString),
    clock: new SystemClock(),
    idGenerator: new UuidVersion7Generator(),
    securityEventLog: new ConsoleSecurityEventLog(),
    sessionSigningKey: {
      keyId: environment.SESSION_SIGNING_KEY_ID,
      privateKey: await crypto.subtle.importKey("jwk", privateJwk, curve, false, ["sign"]),
      publicKey: await crypto.subtle.importKey("jwk", publicJwk, curve, false, ["verify"]),
    },
    auditHashKey: {
      keyId: environment.AUDIT_HASH_KEY_ID,
      key: await importHashKey(environment.AUDIT_HASH_KEY),
    },
    identifierHashKey: await importHashKey(environment.IDENTIFIER_HASH_KEY),
  });
}

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
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

import { FixedClock } from "../../../../adapter/clock/fixed-clock.ts";
import { UuidVersion7Generator } from "../../../../adapter/identifier/uuid-version7-generator.ts";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { RecordingSecurityEventLog } from "../../../../adapter/security-event-log/recording-security-event-log.ts";
import { importHashKey } from "../../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import { type Application, createApplication } from "../../src/application.ts";
import { errorResponse } from "../../src/http/responses.ts";
import { loadBundledPolicySet } from "../../src/policy-set.ts";
import { importSessionSigningKey } from "../../src/worker.ts";

/**
 * The Worker the end-to-end verification tests run: the real application in the Workers runtime, with the
 * specs' fixed instant and test keys. Never deployed.
 */
interface Environment {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly APPLICATION_ORIGIN: string;
  readonly SESSION_SIGNING_KEY: string;
  readonly AUDIT_HASH_KEY: string;
  readonly IDENTIFIER_HASH_KEY: string;
}

const SPEC_INSTANT = new Date("2026-10-22T15:00:00Z");
let application: Promise<Application> | undefined;

async function build(environment: Environment): Promise<Application> {
  return createApplication({
    applicationOrigin: environment.APPLICATION_ORIGIN,
    openDatabase: () => PostgresConnection.open(environment.HYPERDRIVE.connectionString),
    clock: new FixedClock(SPEC_INSTANT),
    idGenerator: new UuidVersion7Generator(),
    securityEventLog: new RecordingSecurityEventLog(),
    sessionSigningKey: {
      keyId: "session-key-1",
      ...(await importSessionSigningKey(environment.SESSION_SIGNING_KEY)),
    },
    auditHashKey: { keyId: "audit-key-1", key: await importHashKey(environment.AUDIT_HASH_KEY) },
    identifierHashKey: await importHashKey(environment.IDENTIFIER_HASH_KEY),
    policySet: await loadBundledPolicySet(),
    forwardToCaseAgent: async () => errorResponse("not_found"),
  });
}

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    application ??= build(environment);
    return (await application).fetch(request);
  },
};

import type { webcrypto } from "node:crypto";
import { SystemClock } from "../../../adapter/clock/system-clock.ts";
import { UuidVersion7Generator } from "../../../adapter/identifier/uuid-version7-generator.ts";
import { PostgresConnection } from "../../../adapter/postgres/postgres-connection.ts";
import { ConsoleSecurityEventLog } from "../../../adapter/security-event-log/console-security-event-log.ts";
import { createWorkersAI, simulateStreamingMiddleware, wrapLanguageModel } from "../../../external/ai.ts";
import { importHashKey } from "../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import { type Application, createApplication } from "./application.ts";
import {
  caseAgentObject,
  type DurableObjectNamespace,
  forwardToCaseAgent,
  MessageRateLimiterObject,
} from "./durable-objects.ts";
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
  readonly AI: unknown;
  readonly CASE_AGENT: DurableObjectNamespace;
  readonly MESSAGE_RATE_LIMITER: DurableObjectNamespace;
}

let application: Promise<Application> | undefined;

/** The application of this isolate, shared by the fetch handler and the Durable Objects. */
function applicationFor(environment: Environment): Promise<Application> {
  application ??= build(environment).catch((error: unknown) => {
    // A failed start is not cached: the next request builds again.
    application = undefined;
    throw error;
  });
  return application;
}

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
    forwardToCaseAgent: (request, caseId, session) =>
      forwardToCaseAgent(environment.CASE_AGENT, request, caseId, session),
  });
}

export default {
  /** Every request reaches the Worker first (`run_worker_first`), so plain HTTP is redirected before any page is served. */
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const redirect = httpsRedirect(request, environment.APPLICATION_ORIGIN);
    if (redirect !== undefined) return redirect;
    if (!servedByApplication(new URL(request.url).pathname)) return environment.ASSETS.fetch(request);
    let running: Application;
    try {
      running = await applicationFor(environment);
    } catch (error) {
      // Nothing about the failure is returned.
      console.error(JSON.stringify({ log: "application-start-failed", message: String(error) }));
      return errorResponse("server_error");
    }
    return running.fetch(request);
  },
};

/** The model behind the case agent (AI_AS_DEVELOPER.md §1: Llama 3.3 70B Instruct on Workers AI). */
const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** The case agent of each case (a Durable Object per case), answering with Workers AI. */
export const CaseAgentObject = caseAgentObject<Environment>({
  applicationFor,
  // The model is called without streaming and its answer replayed as a stream: streamed tool-call arguments from
  // Workers AI arrive garbled for this model, while a whole answer carries them intact (discovery 29).
  languageModelFor: (environment) =>
    wrapLanguageModel({
      // The binding's type comes from the Workers runtime; the provider checks it on first use.
      model: createWorkersAI({ binding: environment.AI as never })(WORKERS_AI_MODEL),
      middleware: simulateStreamingMiddleware(),
    }),
});

export { MessageRateLimiterObject };

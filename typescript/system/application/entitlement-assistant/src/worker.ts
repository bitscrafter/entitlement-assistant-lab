import type { webcrypto } from "node:crypto";
import { SystemClock } from "../../../adapter/clock/system-clock.ts";
import { UuidVersion7Generator } from "../../../adapter/identifier/uuid-version7-generator.ts";
import { PostgresConnection } from "../../../adapter/postgres/postgres-connection.ts";
import { ConsoleSecurityEventLog } from "../../../adapter/security-event-log/console-security-event-log.ts";
import { createWorkersAI, simulateStreamingMiddleware, wrapLanguageModel } from "../../../external/ai.ts";
import { SIGN_IN_ATTEMPTS_PER_MINUTE, usageCapsOf } from "../../../kernel/usage-caps.ts";
import { importHashKey } from "../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import { type Application, createApplication } from "./application.ts";
import {
  approvalProcessWorkflow,
  WorkflowApprovalProcess,
  type WorkflowBinding,
} from "./approval-process-workflow.ts";
import {
  caseAgentObject,
  DailyAllowanceObject,
  DurableObjectCaseEventsDelivery,
  DurableObjectCaseWebSocketConnections,
  DurableObjectDailyAllowance,
  DurableObjectMessageRateLimiter,
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
  readonly APPROVAL_PROCESS: WorkflowBinding;
  readonly DAILY_ALLOWANCE: DurableObjectNamespace;
  /** The demo's AI budget in neurons per UTC day (usage-guards D1); every usage cap derives from it; 0 turns it off. */
  readonly AI_NEURONS_PER_DAY?: string;
  /** The estimated neurons of one model call, to calibrate from the dashboard (usage-guards D1). */
  readonly NEURONS_PER_MODEL_CALL?: string;
  /** How long an approval waits for a decision, in seconds (grants-and-approvals D9); 72 hours when unset. */
  readonly APPROVAL_WINDOW_SECONDS?: string;
  /** How old an undelivered outbox message is before the sweep delivers it, in seconds (D6); 60 when unset. */
  readonly OUTBOX_RETRY_AFTER_SECONDS?: string;
}

/** A whole number from a setting, 0 included; the default when unset or malformed. */
export function wholeNumberSetting(value: string | undefined, defaultValue: number): number {
  const number = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(number) && number >= 0
    ? number
    : defaultValue;
}

/** A positive whole number of seconds from a setting, in milliseconds; the default when unset or malformed. */
export function secondsSetting(value: string | undefined, defaultSeconds: number): number {
  const seconds = Number(value);
  return (value !== undefined && Number.isInteger(seconds) && seconds > 0 ? seconds : defaultSeconds) * 1000;
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
  const clock = new SystemClock();
  return createApplication({
    applicationOrigin: environment.APPLICATION_ORIGIN,
    openDatabase: () => PostgresConnection.open(environment.HYPERDRIVE.connectionString),
    clock,
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
    caseWebSocketConnections: new DurableObjectCaseWebSocketConnections(environment.CASE_AGENT),
    searchRateLimiter: new DurableObjectMessageRateLimiter(
      environment.MESSAGE_RATE_LIMITER,
      "account-search:",
    ),
    caseEventsDelivery: new DurableObjectCaseEventsDelivery(environment.CASE_AGENT),
    approvalProcess: new WorkflowApprovalProcess(environment.APPROVAL_PROCESS, clock),
    dailyAllowance: new DurableObjectDailyAllowance(environment.DAILY_ALLOWANCE),
    usageCaps: usageCapsOf({
      neuronsPerDay: wholeNumberSetting(environment.AI_NEURONS_PER_DAY, 10_000),
      neuronsPerModelCall: wholeNumberSetting(environment.NEURONS_PER_MODEL_CALL, 100),
    }),
    signInRateLimiter: new DurableObjectMessageRateLimiter(
      environment.MESSAGE_RATE_LIMITER,
      "sign-in:",
      SIGN_IN_ATTEMPTS_PER_MINUTE,
    ),
    approvalWindowMilliseconds: secondsSetting(environment.APPROVAL_WINDOW_SECONDS, 72 * 60 * 60),
    outboxRetryAfterMilliseconds: secondsSetting(environment.OUTBOX_RETRY_AFTER_SECONDS, 60),
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

  /** The Cron trigger (grants-and-approvals D6, D10): grant expiries, overdue approvals, and the outbox. */
  async scheduled(_controller: unknown, environment: Environment): Promise<void> {
    await (await applicationFor(environment)).sweep();
  },
};

/** The approval process of each approval (a Workflow instance per approval). */
export const ApprovalProcessWorkflow = approvalProcessWorkflow<Environment>(applicationFor);

/** The model behind the case agent (ADR CM-19: gpt-oss-120b on Workers AI, chosen by spike K5). */
const WORKERS_AI_MODEL = "@cf/openai/gpt-oss-120b";

/** The case agent of each case (a Durable Object per case), answering with Workers AI. */
export const CaseAgentObject = caseAgentObject<Environment>({
  applicationFor,
  // The model is called without streaming and its answer replayed as a stream: streamed tool-call arguments from
  // Workers AI arrived garbled (discovery 29), while a whole answer carries them intact.
  languageModelFor: (environment) =>
    wrapLanguageModel({
      // The binding's type comes from the Workers runtime; the provider checks it on first use.
      model: createWorkersAI({ binding: environment.AI as never })(WORKERS_AI_MODEL),
      middleware: simulateStreamingMiddleware(),
    }),
});

export { DailyAllowanceObject, MessageRateLimiterObject };

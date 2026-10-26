import { FixedClock } from "../../../../adapter/clock/fixed-clock.ts";
import { UuidVersion7Generator } from "../../../../adapter/identifier/uuid-version7-generator.ts";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { RecordingSecurityEventLog } from "../../../../adapter/security-event-log/recording-security-event-log.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import { importHashKey } from "../../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import { type Application, createApplication } from "../../src/application.ts";
import {
  caseAgentObject,
  DurableObjectCaseEventsDelivery,
  DurableObjectCaseWebSocketConnections,
  DurableObjectMessageRateLimiter,
  type DurableObjectNamespace,
  forwardToCaseAgent,
  MessageRateLimiterObject,
} from "../../src/durable-objects.ts";
import { loadBundledPolicySet } from "../../src/policy-set.ts";
import { importSessionSigningKey } from "../../src/worker.ts";
import { ScriptedLanguageModel, type ScriptedStep } from "../support/scripted-language-model.ts";

/**
 * The Worker the end-to-end verification tests run: the real application and case agent in the Workers runtime,
 * with the specs' fixed instant, test keys, and the scripted model. Never deployed. Its settings have a `TEST_`
 * prefix, so no local development secret (.dev.vars) can stand in for them. Routes under `/__test/` let a test move
 * the clock, script the model, read the security events, and run the expiry the alarm would run.
 */
interface Environment {
  readonly HYPERDRIVE: { readonly connectionString: string };
  readonly TEST_APPLICATION_ORIGIN: string;
  readonly TEST_SESSION_SIGNING_KEY: string;
  readonly TEST_AUDIT_HASH_KEY: string;
  readonly TEST_IDENTIFIER_HASH_KEY: string;
  /** The scripted model's first steps, as JSON. */
  readonly TEST_LANGUAGE_MODEL_SCRIPT: string;
  readonly CASE_AGENT: DurableObjectNamespace;
  readonly MESSAGE_RATE_LIMITER: DurableObjectNamespace;
}

const clock = new FixedClock(new Date("2026-10-22T15:00:00Z"));
const securityEvents = new RecordingSecurityEventLog();
let model: ScriptedLanguageModel | undefined;
let application: Promise<Application> | undefined;
/** The case whose agent the model-call route asks when no case is named: the last one connected to. */
let lastConnectedCase: string | undefined;
/** Set by the `drop-event-deliveries` control: the next deliveries are lost (S37b case B). */
let dropEventDeliveries = false;

function applicationFor(environment: Environment): Promise<Application> {
  application ??= (async () =>
    createApplication({
      applicationOrigin: environment.TEST_APPLICATION_ORIGIN,
      openDatabase: () => PostgresConnection.open(environment.HYPERDRIVE.connectionString),
      clock,
      idGenerator: new UuidVersion7Generator(),
      securityEventLog: securityEvents,
      sessionSigningKey: {
        keyId: "session-key-1",
        ...(await importSessionSigningKey(environment.TEST_SESSION_SIGNING_KEY)),
      },
      auditHashKey: { keyId: "audit-key-1", key: await importHashKey(environment.TEST_AUDIT_HASH_KEY) },
      identifierHashKey: await importHashKey(environment.TEST_IDENTIFIER_HASH_KEY),
      policySet: await loadBundledPolicySet(),
      forwardToCaseAgent: (request, caseId, session) => {
        lastConnectedCase = caseId;
        return forwardToCaseAgent(environment.CASE_AGENT, request, caseId, session);
      },
      caseWebSocketConnections: new DurableObjectCaseWebSocketConnections(environment.CASE_AGENT),
      searchRateLimiter: new DurableObjectMessageRateLimiter(
        environment.MESSAGE_RATE_LIMITER,
        "account-search:",
      ),
      // A delivery the test drops, so the agent must repair it on the next connection (S37b case B).
      caseEventsDelivery: {
        deliver: (caseId) =>
          dropEventDeliveries
            ? Promise.resolve()
            : new DurableObjectCaseEventsDelivery(environment.CASE_AGENT).deliver(caseId),
      },
    }))();
  return application;
}

function scriptedModel(environment: Environment): ScriptedLanguageModel {
  if (model === undefined) {
    model = new ScriptedLanguageModel();
    model.script(...(JSON.parse(environment.TEST_LANGUAGE_MODEL_SCRIPT) as ScriptedStep[]));
  }
  return model;
}

const BaseCaseAgentObject = caseAgentObject<Environment>({
  applicationFor,
  languageModelFor: (environment) => scriptedModel(environment).model,
});

/** The case agent, with the test controls that run inside it. */
export class CaseAgentObject extends BaseCaseAgentObject {
  override async onRequest(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.split("/")[2];
    switch (action) {
      case "language-model-calls":
        return new Response(String(scriptedModel(this.env).calls));
      case "offered-tools":
        return Response.json(scriptedModel(this.env).offeredTools);
      case "last-instructions":
        return new Response(scriptedModel(this.env).lastInstructions);
      case "script":
        scriptedModel(this.env).script(...((await request.json()) as ScriptedStep[]));
        return new Response(null, { status: 204 });
      case "clock":
        clock.setTo(new Date(await request.text()));
        return new Response(null, { status: 204 });
      case "security-events":
        return Response.json(securityEvents.events.map((event) => event.cause));
      case "messages":
        return Response.json(this.messages);
      case "state":
        return Response.json({ state: this.state ?? null });
      case "schedules":
        return Response.json(
          (await this.listSchedules()).map((schedule) => ({
            callback: schedule.callback,
            delay_seconds: schedule.type === "delayed" ? schedule.delayInSeconds : null,
          })),
        );
      case "run-schedules":
        // Runs what the agent scheduled, by name, as the alarm would.
        for (const schedule of await this.listSchedules()) {
          await (this as unknown as Record<string, () => Promise<void>>)[schedule.callback]?.call(this);
          await this.cancelSchedule(schedule.id);
        }
        return new Response(null, { status: 204 });
      case "close-expired":
        await this.closeExpiredConnections();
        return new Response(null, { status: 204 });
      default:
        return new Response(null, { status: 404 });
    }
  }
}

export { MessageRateLimiterObject };

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__test/rate-limit") {
      const limiter = new DurableObjectMessageRateLimiter(environment.MESSAGE_RATE_LIMITER);
      const at = new Date(Number(url.searchParams.get("at")));
      return new Response(await limiter.attempt(url.searchParams.get("account") as Uuid, at));
    }
    if (url.pathname.startsWith("/__test/")) {
      const action = url.pathname.split("/")[2];
      if (action === "clock") clock.setTo(new Date(await request.clone().text()));
      if (action === "drop-event-deliveries") {
        dropEventDeliveries = (await request.text()) === "true";
        return new Response(null, { status: 204 });
      }
      const caseId = url.searchParams.get("case") ?? lastConnectedCase;
      if (caseId === undefined) return new Response(action === "language-model-calls" ? "0" : null);
      const agent = environment.CASE_AGENT.get(environment.CASE_AGENT.idFromName(caseId));
      return agent.fetch(new Request(`https://case-agent.internal/__test/${action}`, request));
    }
    return (await applicationFor(environment)).fetch(request);
  },
};

import { AIChatAgent, getAgentByName, getCurrentAgent } from "../../../external/agents.ts";
import { convertToModelMessages, type LanguageModel, stepCountIs, streamText } from "../../../external/ai.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import { attemptInWindow } from "../../../kernel/message-rate.ts";
import type { MessageRateLimiter } from "../../../port/message-rate-limiter.ts";
import { shownToolError, turnErrorLogOf } from "./agent/agent-tools.ts";
import { CASE_AGENT_INSTRUCTIONS, finalStepAnswersInWords } from "./agent/instructions.ts";
import { CLOSES, type ConnectionSession } from "./agent/websocket-message-guard.ts";
import type { Application, CaseAgentParts } from "./application.ts";
import type { CaseEventsDelivery } from "./case-events-delivery.ts";
import type { CaseWebSocketConnections } from "./case-websocket-connections.ts";

/** At most this many of the case's latest events are given to the model (D21). */
const MAXIMUM_EVENTS_TOLD = 30;

/** The instructions of one turn: the standing instructions, the case's events, oldest first, and the case state line (D22). */
export function turnInstructions(events: readonly { readonly text: string }[], state: string): string {
  const told = events.slice(-MAXIMUM_EVENTS_TOLD);
  const eventLines =
    told.length === 0
      ? "Case events: none yet."
      : `Case events, oldest first:\n${told.map((event) => `- ${event.text}`).join("\n")}`;
  return `${CASE_AGENT_INSTRUCTIONS}\n\n${eventLines}\n\n${state}`;
}

/** How many model steps one message may cause: the model sometimes repeats a tool call (spike K3). */
const MAXIMUM_MODEL_STEPS = 5;
const SESSION_HEADER = "x-connection-session";

/** The part of the Workers runtime's Durable Object API the rate limiter uses (structural, so Node can type-check it). */
interface DurableObjectStorage {
  get<Value>(key: string): Promise<Value | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/**
 * Hands an accepted upgrade to the case's agent (D1 and D9 are checked by the Worker first). The request to the
 * agent is built afresh: the handshake headers and the verified session only, never the client's headers.
 */
export async function forwardToCaseAgent(
  namespace: DurableObjectNamespace,
  request: Request,
  caseId: Uuid,
  session: ConnectionSession,
): Promise<Response> {
  const headers = new Headers({ Upgrade: "websocket", Connection: "Upgrade" });
  for (const name of [
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-protocol",
    "sec-websocket-extensions",
  ]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set(SESSION_HEADER, JSON.stringify(session));
  const agent = await getAgentByName(namespace as never, caseId);
  return agent.fetch(new Request(request.url, { headers }));
}

/**
 * The case WebSocket connections adapter of the Worker (case-lifecycle D7): a Durable Object RPC method on the
 * case's agent, which no route reaches (spike K1).
 */
export class DurableObjectCaseWebSocketConnections implements CaseWebSocketConnections {
  readonly #namespace: DurableObjectNamespace;

  constructor(namespace: DurableObjectNamespace) {
    this.#namespace = namespace;
  }

  async closeAll(caseId: Uuid): Promise<void> {
    const agent = await getAgentByName(this.#namespace as never, caseId);
    await (agent as unknown as { closeCaseConnections(): Promise<void> }).closeCaseConnections();
  }
}

/** The case events delivery adapter of the Worker (case-lifecycle D21): an RPC method on the case's agent. */
export class DurableObjectCaseEventsDelivery implements CaseEventsDelivery {
  readonly #namespace: DurableObjectNamespace;

  constructor(namespace: DurableObjectNamespace) {
    this.#namespace = namespace;
  }

  async deliver(caseId: Uuid): Promise<void> {
    const agent = await getAgentByName(this.#namespace as never, caseId);
    await (agent as unknown as { appendCaseEvents(): Promise<void> }).appendCaseEvents();
  }
}

/** The rate limiter adapter of the Worker: one Durable Object per employee account (D13). */
export class DurableObjectMessageRateLimiter implements MessageRateLimiter {
  readonly #namespace: DurableObjectNamespace;
  readonly #scope: string;

  /** `scope` keeps separate counters per use (chat messages; the case panel's account search, D18). */
  constructor(namespace: DurableObjectNamespace, scope = "") {
    this.#namespace = namespace;
    this.#scope = scope;
  }

  async attempt(accountId: Uuid, at: Date): Promise<"Allowed" | "Refused"> {
    const response = await this.#namespace
      .get(this.#namespace.idFromName(`${this.#scope}${accountId}`))
      .fetch(
        new Request("https://message-rate-limiter.internal/attempt", {
          method: "POST",
          body: String(at.getTime()),
        }),
      );
    return (await response.text()) === "Allowed" ? "Allowed" : "Refused";
  }
}

/** One employee's message count over a sliding minute, kept in its own Durable Object. */
export class MessageRateLimiterObject {
  readonly #storage: DurableObjectStorage;

  constructor(state: { readonly storage: DurableObjectStorage }) {
    this.#storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const at = Number(await request.text());
    const result = attemptInWindow((await this.#storage.get<number[]>("accepted")) ?? [], at);
    await this.#storage.put("accepted", result.accepted);
    return new Response(result.outcome);
  }
}

interface CaseAgentEnvironment {
  readonly MESSAGE_RATE_LIMITER: DurableObjectNamespace;
}

/** A connection of the Agents SDK, as the case agent uses it. */
interface AgentConnection {
  readonly state: unknown;
  setState(state: unknown): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
}

/** The connection's session, as `onConnect` stored it; null for a connection the Worker did not hand over. */
function sessionOf(connection: AgentConnection | undefined): ConnectionSession | null {
  const stored = (
    connection?.state as { session?: { principalAccountId: Uuid; sessionId: Uuid; expiresAt: string } } | null
  )?.session;
  if (stored === undefined) return null;
  return {
    principalAccountId: stored.principalAccountId,
    sessionId: stored.sessionId,
    expiresAt: new Date(stored.expiresAt),
  };
}

/**
 * The case agent class for one runtime: an `AIChatAgent`, hardened so the browser can only send the text of a new
 * message (discoveries 7 and 20). The Worker answers with Workers AI; the end-to-end tests with the scripted model.
 */
export function caseAgentObject<Environment extends CaseAgentEnvironment>(runtime: {
  readonly applicationFor: (environment: Environment) => Promise<Application>;
  readonly languageModelFor: (environment: Environment) => LanguageModel;
}) {
  return class CaseAgentObject extends AIChatAgent<Environment> {
    #parts: Promise<CaseAgentParts> | undefined;
    /** A reply is streaming: events delivered now wait for it to end (review R4-4). */
    #turnInProgress = false;
    #eventsPending = false;

    constructor(...parameters: ConstructorParameters<typeof AIChatAgent<Environment>>) {
      super(...parameters);
      // The SDK replaces `onMessage` with its own handler in its constructor; this one runs before it, so every
      // WebSocket message passes the WebSocket message guard first and only what the WebSocket message guard builds reaches the SDK.
      const sdkOnMessage = this.onMessage.bind(this);
      this.onMessage = async (connection: AgentConnection, message: string | ArrayBuffer) => {
        const session = sessionOf(connection);
        if (session === null)
          return connection.close(CLOSES.invalidSession.code, CLOSES.invalidSession.reason);
        const frame = typeof message === "string" ? message : new TextDecoder().decode(message);
        const decision = await (await this.#caseAgentParts()).messageGuard.decide(
          frame,
          session,
          this.messages,
        );
        switch (decision.kind) {
          case "Close":
            return connection.close(decision.close.code, decision.close.reason);
          case "Drop":
            return;
          case "PassThrough":
            return sdkOnMessage(connection as never, frame);
          case "Chat":
            return sdkOnMessage(connection as never, decision.frame);
        }
      };
    }

    /** The browser never writes the agent's state. */
    override validateStateChange(_nextState: unknown, source: unknown): void {
      if (source !== "server") throw new Error("The agent's state is written by the server only.");
    }

    /** Keeps the session the Worker verified with the connection, server-side, and schedules its expiry (D6). */
    override async onConnect(
      connection: AgentConnection,
      context: { readonly request: Request },
    ): Promise<void> {
      const header = context.request.headers.get(SESSION_HEADER);
      if (header === null) return connection.close(CLOSES.invalidSession.code, CLOSES.invalidSession.reason);
      const session = JSON.parse(header) as { principalAccountId: Uuid; sessionId: Uuid; expiresAt: string };
      connection.setState({ session });
      // Events a lost delivery missed are appended before the conversation is sent (D21); a failure here is logged
      // and repaired at the next turn, never a refused connection (review R4-3).
      await this.appendCaseEvents().catch((error: unknown) =>
        console.error(JSON.stringify({ log: "case-events-append-failed", message: String(error) })),
      );
      // The stored conversation, in the SDK's own frame, so a reconnecting browser shows it at once (S13).
      connection.send(JSON.stringify({ type: "cf_agent_chat_messages", messages: this.messages }));
      const parts = await this.#caseAgentParts();
      const seconds = Math.max(
        0,
        (new Date(session.expiresAt).getTime() - parts.clock.now().getTime()) / 1000,
      );
      await this.schedule(Math.ceil(seconds), "closeExpiredConnections");
    }

    /**
     * Appends the case's events this conversation does not hold yet, each once, by its audit record's id, and
     * broadcasts them (case-lifecycle D21). Called over RPC by the Worker after an action, and by the agent itself on
     * connect and before each turn, so a lost delivery is repaired.
     */
    async appendCaseEvents(): Promise<void> {
      // During a reply, the conversation's broadcast would reset the reply streaming to the browser: the events wait
      // for the reply to end (review R4-4).
      if (this.#turnInProgress) {
        this.#eventsPending = true;
        return;
      }
      await this.#append(await (await this.#caseAgentParts()).caseEvents());
    }

    /** Appends the events this conversation does not hold yet, each once, by id. */
    async #append(events: readonly { readonly id: string; readonly text: string }[]): Promise<void> {
      const held = new Set(this.messages.map((message) => message.id));
      const missing = events.filter((event) => !held.has(event.id));
      if (missing.length === 0) return;
      await this.persistMessages([
        ...this.messages,
        ...missing.map((event) => ({
          id: event.id,
          role: "system" as const,
          parts: [{ type: "text" as const, text: event.text }],
        })),
      ]);
    }

    /** Closes every connection: the case was closed (case-lifecycle D7). Called over RPC by the Worker only. */
    async closeCaseConnections(): Promise<void> {
      let closed = 0;
      for (const connection of this.getConnections() as Iterable<AgentConnection>) {
        connection.close(CLOSES.caseUnavailable.code, CLOSES.caseUnavailable.reason);
        closed += 1;
      }
      console.log(JSON.stringify({ log: "case-connections-closed", connections: closed }));
    }

    /** Closes every connection whose session token has expired (D6). */
    async closeExpiredConnections(): Promise<void> {
      const now = (await this.#caseAgentParts()).clock.now();
      for (const connection of this.getConnections() as Iterable<AgentConnection>) {
        const session = sessionOf(connection);
        if (session !== null && now >= session.expiresAt) {
          connection.close(CLOSES.sessionExpired.code, CLOSES.sessionExpired.reason);
        }
      }
    }

    override async onChatMessage(
      onFinish: Parameters<AIChatAgent<Environment>["onChatMessage"]>[0],
    ): Promise<Response> {
      const parts = await this.#caseAgentParts();
      const session = sessionOf(getCurrentAgent().connection as AgentConnection | undefined);
      if (session === null) throw new Error("A chat turn ran without a connection session.");
      const traceId = parts.newTraceId();
      const actor = { principalAccountId: session.principalAccountId, sessionId: session.sessionId };
      // The case's events (D21) and the case as it is now (D22), read fresh in one transaction, audited like any read.
      const { events, state } = await parts.turnContext(actor);
      await this.#append(events);
      this.#turnInProgress = true;
      const turnEnded = () => {
        this.#turnInProgress = false;
        if (this.#eventsPending) {
          this.#eventsPending = false;
          void this.appendCaseEvents().catch((error: unknown) =>
            console.error(JSON.stringify({ log: "case-events-append-failed", message: String(error) })),
          );
        }
      };
      let result: { toUIMessageStreamResponse: ReturnType<typeof streamText>["toUIMessageStreamResponse"] };
      try {
        result = streamText({
          model: runtime.languageModelFor(this.env),
          // Events reach the model in its instructions, not as system messages amid the conversation (review R4-4).
          system: turnInstructions(events, state),
          messages: await convertToModelMessages(
            this.messages.filter((message) => message.role !== "system"),
          ),
          tools: parts.tools(actor),
          stopWhen: stepCountIs(MAXIMUM_MODEL_STEPS),
          prepareStep: ({ stepNumber }) => finalStepAnswersInWords(stepNumber, MAXIMUM_MODEL_STEPS),
          onFinish: (async (...finished: unknown[]) => {
            turnEnded();
            return (onFinish as (...args: unknown[]) => unknown)(...finished);
          }) as never,
          // A turn canceled by the browser ends here, not in onFinish (review R5-3).
          onAbort: () => turnEnded(),
        });
      } catch (error) {
        // A turn that fails before it streams must not hold the events back (review R5-3).
        turnEnded();
        throw error;
      }
      return result.toUIMessageStreamResponse({
        onError: (error) => {
          turnEnded();
          console.error(JSON.stringify(turnErrorLogOf(error, traceId)));
          return shownToolError(error, traceId);
        },
      });
    }

    #caseAgentParts(): Promise<CaseAgentParts> {
      this.#parts ??= runtime.applicationFor(this.env).then((application) =>
        application.caseAgentParts(this.name as Uuid, {
          rateLimiter: new DurableObjectMessageRateLimiter(this.env.MESSAGE_RATE_LIMITER),
        }),
      );
      return this.#parts;
    }
  };
}

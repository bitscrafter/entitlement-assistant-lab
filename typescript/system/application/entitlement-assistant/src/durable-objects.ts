import { AIChatAgent, getAgentByName, getCurrentAgent } from "../../../external/agents.ts";
import { convertToModelMessages, type LanguageModel, stepCountIs, streamText } from "../../../external/ai.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import { attemptInWindow } from "../../../kernel/message-rate.ts";
import type { MessageRateLimiter } from "../../../port/message-rate-limiter.ts";
import { shownToolError, turnErrorLogOf } from "./agent/agent-tools.ts";
import { CASE_AGENT_INSTRUCTIONS, finalStepAnswersInWords } from "./agent/instructions.ts";
import { CLOSES, type ConnectionSession } from "./agent/websocket-message-guard.ts";
import type { Application, CaseAgentParts } from "./application.ts";

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

/** The rate limiter adapter of the Worker: one Durable Object per employee account (D13). */
export class DurableObjectMessageRateLimiter implements MessageRateLimiter {
  readonly #namespace: DurableObjectNamespace;

  constructor(namespace: DurableObjectNamespace) {
    this.#namespace = namespace;
  }

  async attempt(accountId: Uuid, at: Date): Promise<"Allowed" | "Refused"> {
    const response = await this.#namespace.get(this.#namespace.idFromName(accountId)).fetch(
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
      // The stored conversation, in the SDK's own frame, so a reconnecting browser shows it at once (S13).
      connection.send(JSON.stringify({ type: "cf_agent_chat_messages", messages: this.messages }));
      const parts = await this.#caseAgentParts();
      const seconds = Math.max(
        0,
        (new Date(session.expiresAt).getTime() - parts.clock.now().getTime()) / 1000,
      );
      await this.schedule(Math.ceil(seconds), "closeExpiredConnections");
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
      const result = streamText({
        model: runtime.languageModelFor(this.env),
        system: CASE_AGENT_INSTRUCTIONS,
        messages: await convertToModelMessages(this.messages),
        tools: parts.tools({ principalAccountId: session.principalAccountId, sessionId: session.sessionId }),
        stopWhen: stepCountIs(MAXIMUM_MODEL_STEPS),
        prepareStep: ({ stepNumber }) => finalStepAnswersInWords(stepNumber, MAXIMUM_MODEL_STEPS),
        onFinish: onFinish as never,
      });
      return result.toUIMessageStreamResponse({
        onError: (error) => {
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

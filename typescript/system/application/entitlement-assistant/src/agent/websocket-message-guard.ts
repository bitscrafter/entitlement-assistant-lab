import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { MessageRateLimiter } from "../../../../port/message-rate-limiter.ts";

/** What the server keeps for one agent connection; the client can never write it (connection session). */
export interface ConnectionSession {
  readonly principalAccountId: Uuid;
  readonly sessionId: Uuid;
  /** The expiry of the session token the connection was opened with (D6). */
  readonly expiresAt: Date;
}

/** A frame larger than the HTTP body limit is refused before anything else (D11). */
export const MAXIMUM_FRAME_BYTES = 16 * 1024;

/** The close codes of the case agent connection (api.md §8). */
export const CLOSES = {
  messageTooBig: { code: 1009, reason: "message_too_big" },
  rateLimited: { code: 4429, reason: "rate_limited" },
  /** The employee's messages for the UTC day are used up (usage-guards D3). */
  dailyLimit: { code: 4430, reason: "daily_limit" },
  sessionExpired: { code: 4401, reason: "session_expired" },
  caseUnavailable: { code: 4404, reason: "case_unavailable" },
  invalidSession: { code: 4401, reason: "invalid_session" },
} as const;

export type Close = (typeof CLOSES)[keyof typeof CLOSES];

/** WebSocket messages of the Agents SDK protocol that only read or stop the caller's own stream. */
const PASSED_THROUGH: ReadonlySet<string> = new Set([
  "cf_agent_stream_resume_request",
  "cf_agent_stream_resume_ack",
  "cf_agent_chat_request_cancel",
]);

/** What the agent does with one WebSocket message. */
export type GuardDecision =
  | { readonly kind: "Close"; readonly close: Close }
  /** Ignored: a frame that could write the conversation, a tool result, an approval, or the agent's state. */
  | { readonly kind: "Drop" }
  /** Handed to the SDK as given, once the session is checked: it only reads or stops the caller's own stream. */
  | { readonly kind: "PassThrough" }
  /** A chat request rebuilt by the server: its stored history and the newest user message's text only. */
  | { readonly kind: "Chat"; readonly frame: string };

export interface WebSocketMessageGuardDependencies {
  readonly rateLimiter: MessageRateLimiter;
  /** Takes one of the employee's messages for the UTC day (usage-guards D3); `Allowed` while the assistant is off. */
  readonly takeDailyMessage: (accountId: Uuid, at: Date) => Promise<"Allowed" | "Refused">;
  readonly clock: Clock;
  /** Whether the principal may still act, loaded fresh (D10, CM-16). */
  readonly principalMayAct: (accountId: Uuid) => Promise<boolean>;
  /** Whether the case is still open and assigned to the principal (case-lifecycle D9; review R4). */
  readonly caseStillAssigned: (accountId: Uuid) => Promise<boolean>;
  readonly newMessageId: () => string;
}

/**
 * Decides every WebSocket message before the Agents SDK sees it, in the order of the spec: size (D11), then the frame's
 * kind, then for a chat request the rate (D13), the token's expiry (D6), and the principal (D10).
 */
export class WebSocketMessageGuard {
  readonly #dependencies: WebSocketMessageGuardDependencies;

  constructor(dependencies: WebSocketMessageGuardDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * @ensures A frame over 16 KiB closes the connection with 1009, before anything else is checked.
   * @ensures Only a chat request reaches the model, rebuilt from `storedMessages` and the newest user message's text:
   *          history, triggers, client tools, and body fields a client sends are ignored.
   * @ensures A frame the SDK would let write the conversation, a tool result or approval, or the state is dropped.
   * @ensures A chat request past the rate limit closes with 4429; past the employee's messages for the day with 4430
   *          (usage-guards D3); after the token's expiry with 4401
   *          `session_expired`, and for a principal who may no longer act with 4401 `invalid_session`; the principal
   *          is re-loaded only after the other checks pass.
   * @ensures A stream frame (resume, cancel) is checked for the token's expiry and re-loads the principal (D6, D10),
   *          closing as a chat request would; it is not counted (D13 counts messages to the model).
   * @ensures Last, a case closed or no longer assigned to the principal closes with `4404 case_unavailable`, so a
   *          connection the case's close missed is closed at its next message (case-lifecycle D9; review R4).
   */
  async decide(
    frame: string,
    session: ConnectionSession,
    storedMessages: readonly unknown[],
  ): Promise<GuardDecision> {
    if (new TextEncoder().encode(frame).length > MAXIMUM_FRAME_BYTES)
      return { kind: "Close", close: CLOSES.messageTooBig };
    const parsed = parseJson(frame) as
      | { type?: unknown; id?: unknown; init?: { body?: unknown } }
      | undefined;
    if (typeof parsed?.type !== "string") return { kind: "Drop" };
    if (PASSED_THROUGH.has(parsed.type)) {
      const close = await this.#sessionClose(session, this.#dependencies.clock.now());
      return close === null ? { kind: "PassThrough" } : { kind: "Close", close };
    }
    if (parsed.type !== "cf_agent_use_chat_request" || typeof parsed.id !== "string") return { kind: "Drop" };
    const text = newestUserText(parsed.init?.body);
    if (text === null) return { kind: "Drop" };

    const now = this.#dependencies.clock.now();
    if ((await this.#dependencies.rateLimiter.attempt(session.principalAccountId, now)) === "Refused") {
      return { kind: "Close", close: CLOSES.rateLimited };
    }
    if ((await this.#dependencies.takeDailyMessage(session.principalAccountId, now)) === "Refused") {
      return { kind: "Close", close: CLOSES.dailyLimit };
    }
    const close = await this.#sessionClose(session, now);
    if (close !== null) return { kind: "Close", close };
    const userMessage = {
      id: this.#dependencies.newMessageId(),
      role: "user",
      parts: [{ type: "text", text }],
    };
    return {
      kind: "Chat",
      frame: JSON.stringify({
        type: "cf_agent_use_chat_request",
        id: parsed.id,
        init: { method: "POST", body: JSON.stringify({ messages: [...storedMessages, userMessage] }) },
      }),
    };
  }

  /** The close for a session whose token has expired or whose principal may no longer act; the principal last. */
  async #sessionClose(session: ConnectionSession, now: Date): Promise<Close | null> {
    if (now >= session.expiresAt) return CLOSES.sessionExpired;
    if (!(await this.#dependencies.principalMayAct(session.principalAccountId))) return CLOSES.invalidSession;
    if (!(await this.#dependencies.caseStillAssigned(session.principalAccountId)))
      return CLOSES.caseUnavailable;
    return null;
  }
}

/** The text of the newest user message of a chat request's body; null when there is none. */
function newestUserText(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const parsed = parseJson(body) as
    | { messages?: { role?: unknown; parts?: { type?: unknown; text?: unknown }[] }[] }
    | undefined;
  const newest = [...(parsed?.messages ?? [])].reverse().find((message) => message.role === "user");
  if (newest === undefined) return null;
  return (newest.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

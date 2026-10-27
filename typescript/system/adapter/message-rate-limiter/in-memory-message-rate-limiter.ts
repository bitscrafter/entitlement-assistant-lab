import { attemptInWindow, MESSAGE_LIMIT } from "../../kernel/message-rate.ts";
import type { MessageRateLimiter } from "../../port/message-rate-limiter.ts";

/** A rate limiter held in memory, for a single process (tests, local runs). */
export class InMemoryMessageRateLimiter implements MessageRateLimiter {
  readonly #accepted = new Map<string, readonly number[]>();
  readonly #limit: number;

  /** `limit` attempts per key per minute: chat messages by default (explain-access D13). */
  constructor(limit = MESSAGE_LIMIT) {
    this.#limit = limit;
  }

  async attempt(key: string, at: Date): Promise<"Allowed" | "Refused"> {
    const result = attemptInWindow(this.#accepted.get(key) ?? [], at.getTime(), this.#limit);
    this.#accepted.set(key, result.accepted);
    return result.outcome;
  }
}

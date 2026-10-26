import type { Uuid } from "../../kernel/identifier.ts";
import type { MessageRateLimiter } from "../../port/message-rate-limiter.ts";
import { attemptInWindow } from "./sliding-window.ts";

/** A message rate limiter held in memory, for a single process (tests, local runs). */
export class InMemoryMessageRateLimiter implements MessageRateLimiter {
  readonly #accepted = new Map<Uuid, readonly number[]>();

  async attempt(accountId: Uuid, at: Date): Promise<"Allowed" | "Refused"> {
    const result = attemptInWindow(this.#accepted.get(accountId) ?? [], at.getTime());
    this.#accepted.set(accountId, result.accepted);
    return result.outcome;
  }
}

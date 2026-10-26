import type { Uuid } from "../../kernel/identifier.ts";
import type { MessageRateLimiter } from "../../port/message-rate-limiter.ts";

/** A message rate limiter held in memory, for a single process (tests, local runs). */
export class InMemoryMessageRateLimiter implements MessageRateLimiter {
  async attempt(_accountId: Uuid, _at: Date): Promise<"Allowed" | "Refused"> {
    return "Allowed";
  }
}

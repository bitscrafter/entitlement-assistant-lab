import type { Uuid } from "../kernel/identifier.ts";

/** Counts an employee's chat messages over a sliding minute, across all their connections and cases (D13). */
export interface MessageRateLimiter {
  /**
   * Records one message attempt by the account at the instant, unless it is over the limit.
   *
   * @ensures Allows at most the configured number of messages per account within any 60 seconds ending at `at`.
   * @ensures A refused attempt is not counted.
   */
  attempt(accountId: Uuid, at: Date): Promise<"Allowed" | "Refused">;
}

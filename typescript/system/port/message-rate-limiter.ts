/**
 * Counts attempts per key over a sliding minute, across every isolate: an employee's chat messages, across all their
 * connections and cases (explain-access D13), or sign-ins from one IP address (usage-guards D6).
 */
export interface MessageRateLimiter {
  /**
   * Records one attempt for the key at the instant, unless it is over the limit.
   *
   * @ensures Allows at most the configured number of attempts per key within any 60 seconds ending at `at`.
   * @ensures A refused attempt is not counted.
   */
  attempt(key: string, at: Date): Promise<"Allowed" | "Refused">;
}

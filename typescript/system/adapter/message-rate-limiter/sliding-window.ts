/** The message rate limit of explain-access D13: 20 messages per employee within any 60 seconds. */
export const MESSAGE_LIMIT = 20;
export const WINDOW_MILLISECONDS = 60_000;

/**
 * One attempt against a sliding window of accepted attempts: the single rule both rate-limiter adapters apply.
 *
 * @ensures Refused exactly when `limit` attempts were accepted within the window ending at `at`.
 * @ensures The returned attempts are the accepted ones still inside the window, the new one included when allowed.
 */
export function attemptInWindow(
  accepted: readonly number[],
  at: number,
  limit = MESSAGE_LIMIT,
  windowMilliseconds = WINDOW_MILLISECONDS,
): { readonly outcome: "Allowed" | "Refused"; readonly accepted: readonly number[] } {
  const recent = accepted.filter((instant) => instant > at - windowMilliseconds);
  if (recent.length >= limit) return { outcome: "Refused", accepted: recent };
  return { outcome: "Allowed", accepted: [...recent, at] };
}

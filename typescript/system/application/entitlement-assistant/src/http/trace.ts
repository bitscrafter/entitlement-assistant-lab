const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** The W3C trace id of the request, created at the edge when absent (attribution §7). */
export function traceIdOf(request: Request): string {
  const match = TRACEPARENT.exec(request.headers.get("traceparent") ?? "");
  if (match?.[1] !== undefined && match[1] !== "0".repeat(32)) return match[1];
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

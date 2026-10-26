/** Every response from the Worker carries these (api.md §2; employee-sign-in D7). */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

/** The fixed, top-level errors of api.md §3: safe to show to anyone. */
export const ERRORS = {
  invalid_request: { status: 400, description: "The request is malformed." },
  invalid_session: { status: 401, description: "A valid session is required." },
  invalid_credentials: { status: 401, description: "The email or password is incorrect." },
  forbidden: { status: 403, description: "The request is not allowed." },
  access_denied: { status: 403, description: "The request was denied by policy." },
  absolute_lifetime_reached: { status: 403, description: "The session reached its maximum lifetime." },
  not_found: { status: 404, description: "The resource was not found." },
  conflict: { status: 409, description: "The resource is not in a state that allows this request." },
  rate_limited: { status: 429, description: "Too many requests. Wait a moment, then try again." },
  server_error: { status: 500, description: "An unexpected error occurred." },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: {
      ...BASE_HEADERS,
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(text).length),
      ...headers,
    },
  });
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...headers } });
}

/**
 * An error with the top level only; details are never added here (AU-6). A `server_error` carries the trace
 * id, so the failure can be found in the logs (api.md §3).
 */
export function errorResponse(code: ErrorCode, traceId?: string): Response {
  const error = ERRORS[code];
  const headers: Record<string, string> =
    code === "server_error" && traceId !== undefined ? { "x-trace-id": traceId } : {};
  return jsonResponse(error.status, { error: code, error_description: error.description }, headers);
}

/**
 * An error with details, for a caller who may see them (AU-6): a malformed field for an authenticated caller, the
 * state of a resource for its assignee, or policy reasons for a principal who holds `account.read`.
 */
export function detailedErrorResponse(
  code: "invalid_request" | "conflict" | "access_denied",
  details: readonly { readonly error: string; readonly error_description: string }[],
): Response {
  const error = ERRORS[code];
  return jsonResponse(error.status, {
    error: code,
    error_description: error.description,
    error_details: details,
  });
}

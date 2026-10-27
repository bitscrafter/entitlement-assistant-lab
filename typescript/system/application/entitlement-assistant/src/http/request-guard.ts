import { failure, type Result, success } from "../../../../kernel/result.ts";
import type { SecurityEventCause } from "../../../../port/security-event-log.ts";
import type { SessionClaims, SessionTokenVerifier } from "../../../../port/session-token.ts";
import type {
  EmployeePrincipal,
  LoadPrincipal,
} from "../../../../subsystem/account/src/usecase/load-principal.ts";
import { readSessionCookie } from "./session-cookie.ts";

/** Whether the request asks to open a WebSocket (RFC 6455 §4.1). */
export function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
}

/**
 * Where an HTTP request may come from (api.md A5): every request that is not a GET, and every WebSocket upgrade,
 * carries exactly the application's origin. No other origin is ever allowed, and there is no CORS, which does not
 * cover WebSockets anyway (explain-access D9).
 */
export function originAllowed(request: Request, applicationOrigin: string): boolean {
  if (request.method === "GET" && !isWebSocketUpgrade(request)) return true;
  return request.headers.get("origin") === applicationOrigin;
}

/**
 * Moves a plain-HTTP request to the application's HTTPS origin, so no page is ever served where it can be
 * tampered with in transit. The target comes from the configured origin, never from the request's host.
 *
 * @ensures A plain-HTTP request to an HTTPS application gets a 308 to the application's origin with the same path and query.
 * @ensures Every other request, including any request to a plain-HTTP (local) application, gets `undefined`.
 */
export function httpsRedirect(request: Request, applicationOrigin: string): Response | undefined {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || !applicationOrigin.startsWith("https://")) return undefined;
  return Response.redirect(`${applicationOrigin}${url.pathname}${url.search}`, 308);
}

/**
 * Whether a path is answered by the application rather than by the UI's static assets.
 *
 * @ensures True exactly for paths under `/api/` and `/agents/`.
 */
export function servedByApplication(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/agents/");
}

/** @ensures The verified claims of the request's session token, or why it has none. */
export async function authenticateSession(
  request: Request,
  tokens: SessionTokenVerifier,
  now: Date,
): Promise<Result<SessionClaims, SecurityEventCause>> {
  const token = readSessionCookie(request);
  if (token === null) return failure("NoSession");
  const verified = await tokens.verify(token, now);
  return verified.ok ? verified : failure(verified.failure);
}

export interface AuthenticatedPrincipal {
  readonly claims: SessionClaims;
  readonly principal: EmployeePrincipal;
}

/**
 * The session and the principal it acts for, re-loaded from the database for this request (CM-16, D4).
 *
 * @ensures Fails for an invalid token, and for an account that may not act (`PrincipalInactive`).
 */
export async function authenticatePrincipal(
  request: Request,
  tokens: SessionTokenVerifier,
  loadPrincipal: LoadPrincipal,
  now: Date,
): Promise<Result<AuthenticatedPrincipal, SecurityEventCause>> {
  const session = await authenticateSession(request, tokens, now);
  if (!session.ok) return session;
  const principal = await loadPrincipal.execute(session.value.accountId);
  if (!principal.ok) return failure("PrincipalInactive");
  return success({ claims: session.value, principal: principal.value });
}

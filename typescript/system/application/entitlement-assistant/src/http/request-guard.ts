import { failure, type Result, success } from "../../../../kernel/result.ts";
import type { SecurityEventCause } from "../../../../port/security-event-log.ts";
import type { SessionClaims, SessionTokenVerifier } from "../../../../port/session-token.ts";
import type {
  EmployeePrincipal,
  LoadPrincipal,
} from "../../../../subsystem/account/src/usecase/load-principal.ts";
import { readSessionCookie } from "./session-cookie.ts";

/**
 * Where an HTTP request may come from (api.md A5): every request that is not a GET carries exactly the
 * application's origin. No other origin is ever allowed, and there is no CORS.
 */
export function originAllowed(request: Request, applicationOrigin: string): boolean {
  return request.method === "GET" || request.headers.get("origin") === applicationOrigin;
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

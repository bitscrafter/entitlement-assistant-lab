/** The browser's calls to the authentication endpoints (api.md §4). The cookie travels by itself. */

export interface SessionPrincipal {
  readonly account_id: string;
  readonly display_name: string;
  readonly department: string;
  readonly job_function: string;
  readonly job_level: number;
  readonly roles: readonly string[];
}

export type SignInOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

const JSON_HEADERS = { "Content-Type": "application/json" };

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error_description?: unknown } | null;
  return typeof body?.error_description === "string"
    ? body.error_description
    : "An unexpected error occurred.";
}

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const response = await fetch("/api/authentication/sign-in", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  return response.status === 204 ? { ok: true } : { ok: false, message: await errorMessage(response) };
}

export async function currentPrincipal(): Promise<SessionPrincipal | null> {
  const response = await fetch("/api/authentication/session");
  return response.ok ? ((await response.json()) as SessionPrincipal) : null;
}

/** @ensures True while the session is alive; false once it can no longer be renewed. */
export async function renewSession(): Promise<boolean> {
  const response = await fetch("/api/authentication/session/renewal", { method: "POST" });
  return response.status === 204;
}

export async function signOut(): Promise<void> {
  await fetch("/api/authentication/sign-out", { method: "POST" });
}

/** The browser's call to open a case (api.md §5). The cookie and the Origin travel by themselves. */

export type OpenCaseOutcome =
  | { readonly ok: true; readonly caseId: string }
  | { readonly ok: false; readonly message: string };

export async function openCase(): Promise<OpenCaseOutcome> {
  const response = await fetch("/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await response.json().catch(() => null)) as {
    case_id?: unknown;
    error_description?: unknown;
  } | null;
  if (response.status === 201 && typeof body?.case_id === "string") return { ok: true, caseId: body.case_id };
  return {
    ok: false,
    message:
      typeof body?.error_description === "string" ? body.error_description : "The case could not be opened.",
  };
}

/** An account of the case as the server shows it (case-lifecycle D14, D15). */
export type CaseAccount =
  | { readonly account_id: string; readonly readable: false }
  | {
      readonly account_id: string;
      readonly readable: true;
      readonly display_name: string;
      readonly holds: readonly string[];
      readonly roles_in_subject?: readonly string[] | null;
    };

export interface CaseState {
  readonly case_id: string;
  readonly subject: CaseAccount | null;
  readonly contact: CaseAccount | null;
  readonly contact_authentication: {
    readonly kind: string;
    readonly method: string;
    readonly authenticated_by: string;
    readonly authenticated_at: string;
    readonly expires_at: string;
  } | null;
  readonly opened_at: string;
  readonly closed_at: string | null;
}

export interface PastCase {
  readonly case_id: string;
  readonly closed_at: string;
  readonly closed_by: { readonly account_id: string; readonly display_name: string | null };
  readonly close_reason: string;
  readonly summary: string;
}

/** The outcome of a case action: done, or the server's message for the CSR. */
export type CaseActionOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** The message of an error body: its detail when the server gave one, else its fixed description (api.md §3). */
async function messageOf(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error_description?: unknown;
    error_details?: readonly { error_description?: unknown }[];
  } | null;
  const detail = body?.error_details?.[0]?.error_description;
  if (typeof detail === "string") return detail;
  return typeof body?.error_description === "string" ? body.error_description : fallback;
}

async function caseAction(path: string, method: "PUT" | "POST", body: unknown): Promise<CaseActionOutcome> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.status === 204
    ? { ok: true }
    : { ok: false, message: await messageOf(response, "The case could not be changed.") };
}

/** The case as its assignee sees it; null when it is gone (closed, or not theirs). */
export async function getCase(caseId: string): Promise<CaseState | null> {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
  return response.status === 200 ? ((await response.json()) as CaseState) : null;
}

export const setCaseSubject = (caseId: string, accountId: string) =>
  caseAction(`/api/cases/${encodeURIComponent(caseId)}/subject`, "PUT", { account_id: accountId });

export const setCaseContact = (caseId: string, accountId: string) =>
  caseAction(`/api/cases/${encodeURIComponent(caseId)}/contact`, "PUT", { account_id: accountId });

export const authenticateContact = (caseId: string, kind: string, method: string, passed: boolean) =>
  caseAction(`/api/cases/${encodeURIComponent(caseId)}/contact-authentication`, "POST", {
    kind,
    method,
    passed,
  });

export const closeCase = (caseId: string, closeReason: string, summary: string) =>
  caseAction(`/api/cases/${encodeURIComponent(caseId)}/closure`, "POST", {
    close_reason: closeReason,
    summary,
  });

/** The closed cases of an account the CSR may read; empty when they may not, or there are none. */
export async function closedCases(accountId: string): Promise<readonly PastCase[]> {
  const response = await fetch(`/api/cases?subject=${encodeURIComponent(accountId)}&status=closed`);
  if (response.status !== 200) return [];
  return ((await response.json()) as { cases: readonly PastCase[] }).cases;
}

/** A lookup's answer, as the assistant's tool receives it (case-lifecycle D18). */
export type AccountSearch =
  | {
      readonly result: "found";
      readonly account: {
        readonly account_id: string;
        readonly display_name: string;
        readonly plan_key: string | null;
      };
    }
  | {
      readonly result: "ambiguous";
      readonly candidates: readonly {
        readonly account_id: string;
        readonly display_name: string;
        readonly own_account: boolean;
        readonly roles: readonly string[];
      }[];
      readonly more_matches: boolean;
    };

/** The case panel's account search: the answer, or the server's message for the CSR. */
export async function searchAccounts(
  query: string,
): Promise<
  { readonly ok: true; readonly search: AccountSearch } | { readonly ok: false; readonly message: string }
> {
  const response = await fetch(`/api/accounts?query=${encodeURIComponent(query)}`);
  if (response.status === 200) return { ok: true, search: (await response.json()) as AccountSearch };
  return {
    ok: false,
    message:
      response.status === 404
        ? "No account matched, or it is not one you may read."
        : await messageOf(response, "The search failed."),
  };
}

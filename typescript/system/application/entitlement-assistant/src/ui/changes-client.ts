/** The browser's calls for change requests and approvals (api.md §6, §7; grants-and-approvals D1, D7). */

/** A change request as the card re-reads it. */
export interface ChangeRequestState {
  readonly change_request_id: string;
  readonly change_kind: string;
  readonly status: string;
  readonly status_reason: string | null;
  readonly approval: {
    readonly approval_id: string;
    readonly approval_status: string;
    readonly expires_at: string;
  } | null;
  readonly applied_at: string | null;
}

/** What a click on the card did: the new status, or every reason the server gave (D17). */
export type ChangeActionOutcome =
  | { readonly ok: true; readonly status: string }
  | { readonly ok: false; readonly messages: readonly string[] };

/** Every message of an error body: each detail's description, or the fixed description (api.md §3). */
async function messagesOf(response: Response, fallback: string): Promise<readonly string[]> {
  const body = (await response.json().catch(() => null)) as {
    error_description?: unknown;
    error_details?: readonly { error_description?: unknown }[];
  } | null;
  const details = (body?.error_details ?? [])
    .map((detail) => detail.error_description)
    .filter((description): description is string => typeof description === "string");
  if (details.length > 0) return details;
  return [typeof body?.error_description === "string" ? body.error_description : fallback];
}

const changePath = (caseId: string, changeRequestId: string) =>
  `/api/cases/${encodeURIComponent(caseId)}/change-requests/${encodeURIComponent(changeRequestId)}`;

export async function getChangeRequest(
  caseId: string,
  changeRequestId: string,
): Promise<ChangeRequestState | null> {
  const response = await fetch(changePath(caseId, changeRequestId));
  return response.ok ? ((await response.json()) as ChangeRequestState) : null;
}

/** Confirms or cancels a prepared change: the endpoint decides, never the model (D1). */
export async function changeRequestAction(
  caseId: string,
  changeRequestId: string,
  action: "confirmation" | "cancellation",
): Promise<ChangeActionOutcome> {
  const response = await fetch(`${changePath(caseId, changeRequestId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    return { ok: true, status: typeof body?.status === "string" ? body.status : "" };
  }
  return { ok: false, messages: await messagesOf(response, "The change could not be completed.") };
}

/** A pending approval as the approvals panel lists it (D7). */
export interface PendingApproval {
  readonly approval_id: string;
  readonly expires_at: string;
  readonly change_kind: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly preview_reasons: readonly { readonly code: string; readonly description: string }[];
  readonly subject: { readonly account_id: string; readonly display_name: string | null };
  readonly requested_by: { readonly account_id: string; readonly display_name: string | null };
  readonly confirmed_by: { readonly account_id: string; readonly display_name: string | null } | null;
  readonly requested_at: string;
}

/** @returns The pending approvals; null when the CSR may not decide approvals (the panel is then not shown). */
export async function listApprovals(): Promise<readonly PendingApproval[] | null> {
  const response = await fetch("/api/approvals?status=Pending");
  if (!response.ok) return null;
  return ((await response.json()) as { approvals: readonly PendingApproval[] }).approvals;
}

export type DenialReason = "PolicyLimit" | "InsufficientJustification" | "CustomerNotEligible" | "Other";

export async function decideApproval(
  approvalId: string,
  decision:
    | { readonly decision: "Approved" }
    | {
        readonly decision: "Denied";
        readonly decision_reason: DenialReason;
        readonly decision_comment?: string;
      },
): Promise<ChangeActionOutcome> {
  const response = await fetch(`/api/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { approval_status?: unknown } | null;
    return { ok: true, status: typeof body?.approval_status === "string" ? body.approval_status : "" };
  }
  return { ok: false, messages: await messagesOf(response, "The decision could not be recorded.") };
}

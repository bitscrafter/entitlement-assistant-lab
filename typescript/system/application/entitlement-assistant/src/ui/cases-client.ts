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

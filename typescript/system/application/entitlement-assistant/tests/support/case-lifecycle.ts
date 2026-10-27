import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { encodeIdentifier } from "../../../../kernel/identifier.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { specAuditRecords, validToken } from "./explain-access.ts";
import { at, compact, type Harness, ORIGIN, request, uuidOf } from "./harness.ts";

/** A case's external id, as a path segment. */
export function caseIdOf(caseAlias: string): string {
  return encodeIdentifier("cse", seededUuid(caseAlias));
}

/** An account's external id. */
export function accountIdOf(accountAlias: string): string {
  return encodeIdentifier(accountAlias.startsWith("iac_") ? "iac" : "acc", seededUuid(accountAlias));
}

/** Sends a request to a case endpoint as `principalAlias`, with a valid session and the application's origin. */
export async function caseRequest(
  harness: Harness,
  method: "GET" | "PUT" | "POST",
  path: string,
  principalAlias: string,
  body?: unknown,
  tokenExpiresAt = at("15:20:00"),
): Promise<Response> {
  return harness.application.fetch(
    request(method, path, {
      headers: {
        Origin: ORIGIN,
        Cookie: `__Host-session=${await validToken(harness, principalAlias, tokenExpiresAt)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/** The case's path under `/api/cases`, with an optional action. */
export function casePath(caseAlias: string, action = ""): string {
  return `/api/cases/${caseIdOf(caseAlias)}${action === "" ? "" : `/${action}`}`;
}

export const NOT_FOUND = compact({ error: "not_found", error_description: "The resource was not found." });
export const FORBIDDEN = compact({ error: "forbidden", error_description: "The request is not allowed." });
export const INVALID_SESSION = compact({
  error: "invalid_session",
  error_description: "A valid session is required.",
});

/** A `409 conflict` body with its one state detail (api.md §3). */
export function conflict(detail: string, description: string): string {
  return compact({
    error: "conflict",
    error_description: "The resource is not in a state that allows this request.",
    error_details: [{ error: detail, error_description: description }],
  });
}

/** A `400 invalid_request` body with its one field detail. */
export function invalidRequest(field: string, description: string): string {
  return compact({
    error: "invalid_request",
    error_description: "The request is malformed.",
    error_details: [{ error: field, error_description: description }],
  });
}

/** The case state a Given states, written straight in the tables. */
export async function givenCase(
  owner: PostgresConnection,
  caseAlias: string,
  state: {
    readonly subject?: string;
    readonly contact?: string;
    readonly authenticated?: {
      readonly at: Date;
      readonly kind: string;
      readonly method: string;
      readonly by: string;
    };
    readonly closed?: {
      readonly at: Date;
      readonly by: string;
      readonly reason: string;
      readonly summary: string;
    };
  },
): Promise<void> {
  const caseId = uuidOf(caseAlias);
  if (state.subject !== undefined)
    await owner.query("UPDATE support_case SET subject_account_id = $2 WHERE case_id = $1", [
      caseId,
      uuidOf(state.subject),
    ]);
  if (state.contact !== undefined)
    await owner.query("UPDATE support_case SET contact_account_id = $2 WHERE case_id = $1", [
      caseId,
      uuidOf(state.contact),
    ]);
  if (state.authenticated !== undefined)
    await owner.query(
      `UPDATE support_case SET contact_authenticated_at = $2, contact_authentication_kind = $3,
         contact_authentication_method = $4, contact_authenticated_by = $5 WHERE case_id = $1`,
      [
        caseId,
        state.authenticated.at,
        state.authenticated.kind,
        state.authenticated.method,
        uuidOf(state.authenticated.by),
      ],
    );
  if (state.closed !== undefined) {
    await owner.query(
      `UPDATE support_case SET closed_at = $2, closed_by = $3, close_reason = $4, case_summary = $5
        WHERE case_id = $1`,
      [caseId, state.closed.at, uuidOf(state.closed.by), state.closed.reason, state.closed.summary],
    );
    await owner.query(
      `UPDATE case_assignment SET ended_at = $2, ended_by = $3, end_reason = 'CaseClosed'
        WHERE case_id = $1 AND ended_at IS NULL`,
      [caseId, state.closed.at, uuidOf(state.closed.by)],
    );
  }
}

/** The case's row and its assignments, as the spec's `state` reads them. */
export async function caseState(owner: PostgresConnection, caseAlias: string) {
  const [row] = await owner.query<Record<string, unknown>>(
    `SELECT subject_account_id, contact_account_id, contact_authenticated_at, contact_authentication_kind,
            contact_authentication_method, contact_authenticated_by, closed_at, closed_by, close_reason,
            case_summary
       FROM support_case WHERE case_id = $1`,
    [uuidOf(caseAlias)],
  );
  const assignments = await owner.query<Record<string, unknown>>(
    "SELECT assignee_account_id, ended_at, ended_by, end_reason FROM case_assignment WHERE case_id = $1",
    [uuidOf(caseAlias)],
  );
  return { row, assignments };
}

/** The spec's audit records, without the policy set version (asserted present). */
export async function lifecycleRecords(harness: { readonly owner: PostgresConnection }) {
  return (await specAuditRecords(harness)).map(({ policy_set_version: version, detail, ...record }) => {
    if (version === null) throw new Error(`audit record ${record.action_key} has no policy set version`);
    return { ...record, detail };
  });
}

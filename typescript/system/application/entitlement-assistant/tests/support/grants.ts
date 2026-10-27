import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { decodeIdentifier, encodeIdentifier, type Uuid } from "../../../../kernel/identifier.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { caseIdOf, givenCase } from "./case-lifecycle.ts";
import { at, external, type Harness, insertCase, mintToken, ORIGIN, request, uuidOf } from "./harness.ts";

/** A change as a preparing tool asks for it (grants-and-approvals D1). */
export type ChangeAsked =
  | {
      readonly kind: "CreateGrant";
      readonly featureKey: string;
      readonly quota?: number;
      readonly durationDays: number;
      readonly reason: string;
    }
  | { readonly kind: "RevokeGrant"; readonly grantId: Uuid; readonly reason: string }
  | {
      readonly kind: "ExtendGrant";
      readonly grantId: Uuid;
      readonly durationDays: number;
      readonly reason: string;
    };

/** The spec's default case: cse_alex_1, assigned to `assignee`, subject Initech, contact Bob authenticated 14:55. */
export async function givenGrantCase(
  harness: Harness,
  options: {
    readonly assignee?: string;
    readonly subject?: string;
    readonly contact?: string | null;
    readonly authenticatedAt?: Date | null;
  } = {},
): Promise<void> {
  const assignee = options.assignee ?? "iac_alex";
  await insertCase(harness.owner, "cse_alex_1", assignee, at("14:00:00"));
  const contact = options.contact === undefined ? "acc_bob" : options.contact;
  const authenticatedAt = options.authenticatedAt === undefined ? at("14:55:00") : options.authenticatedAt;
  await givenCase(harness.owner, "cse_alex_1", {
    subject: options.subject ?? "acc_initech",
    ...(contact === null ? {} : { contact }),
    ...(contact === null || authenticatedAt === null
      ? {}
      : {
          authenticated: { at: authenticatedAt, kind: "Knowledge", method: "SecurityQuestion", by: assignee },
        }),
  });
}

export const grantIdOf = (alias: string) => encodeIdentifier("grt", seededUuid(alias));

/** A session token of `alias` that is valid at the harness clock's instant, however far a scenario moved it. */
function tokenNow(harness: Harness, alias: string): Promise<string> {
  const now = harness.clock.now().getTime();
  return mintToken(harness.signingKey, {
    sub: external(alias),
    authTime: new Date(now - 10 * 60 * 1000),
    iat: new Date(now - 10 * 60 * 1000),
    exp: new Date(now + 20 * 60 * 1000),
  });
}

/** Prepares a change in cse_alex_1 as `principal`, through the use case the tools call. */
export async function prepare(harness: Harness, principal: string, change: ChangeAsked) {
  return harness.application.withUseCases((useCases) =>
    useCases.prepareChangeRequest.execute({
      principalAccountId: uuidOf(principal),
      sessionId: null,
      caseId: seededUuid("cse_alex_1"),
      toolCallId: "call_1",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      change,
    }),
  );
}

/** The prepared change request's external id, or a failure naming what came back. */
export function preparedId(result: unknown): string {
  const prepared = result as { kind?: string; changeRequest?: { changeRequestId?: Uuid } };
  if (prepared.kind !== "Prepared" || prepared.changeRequest?.changeRequestId === undefined)
    throw new Error(`not prepared: ${JSON.stringify(result)}`);
  return encodeIdentifier("chg", prepared.changeRequest.changeRequestId);
}

/** A change request endpoint of cse_alex_1, as `principal`. */
export async function changeAction(
  harness: Harness,
  principal: string,
  changeRequestId: string,
  action: "confirmation" | "cancellation",
): Promise<Response> {
  return harness.application.fetch(
    request("POST", `/api/cases/${caseIdOf("cse_alex_1")}/change-requests/${changeRequestId}/${action}`, {
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Cookie: `__Host-session=${await tokenNow(harness, principal)}`,
      },
      body: "{}",
    }),
  );
}

/** The approvals endpoints, as `principal`. */
export async function approvals(harness: Harness, principal: string): Promise<Response> {
  return harness.application.fetch(
    request("GET", "/api/approvals?status=Pending", {
      headers: {
        Origin: ORIGIN,
        Cookie: `__Host-session=${await tokenNow(harness, principal)}`,
      },
    }),
  );
}

export async function decide(
  harness: Harness,
  principal: string,
  approvalId: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return harness.application.fetch(
    request("POST", `/api/approvals/${approvalId}/decision`, {
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Cookie: `__Host-session=${await tokenNow(harness, principal)}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

/** A change request's row. */
export async function changeRequestRow(owner: PostgresConnection, changeRequestId: string) {
  const decoded = decodeIdentifier("chg", changeRequestId);
  if (!decoded.ok) throw new Error(`not a change request id: ${changeRequestId}`);
  const [row] = await owner.query<Record<string, unknown>>(
    "SELECT * FROM change_request WHERE change_request_id = $1",
    [decoded.value],
  );
  return row;
}

/** An approval's row. */
export async function approvalRow(owner: PostgresConnection, approvalId: string) {
  const decoded = decodeIdentifier("apr", approvalId);
  if (!decoded.ok) throw new Error(`not an approval id: ${approvalId}`);
  const [row] = await owner.query<Record<string, unknown>>(
    "SELECT * FROM change_approval WHERE approval_id = $1",
    [decoded.value],
  );
  return row;
}

/** Every grant of an account, oldest first. */
export async function grantsOf(owner: PostgresConnection, accountAlias: string) {
  return owner.query<{
    grant_id: Uuid;
    feature_key: string;
    quota: number | null;
    starts_at: Date;
    expires_at: Date;
    ended_at: Date | null;
    end_reason: string | null;
    extends_grant_id: Uuid | null;
  }>(
    `SELECT g.grant_id, g.feature_key, g.quota, g.starts_at, g.expires_at, g.ended_at, g.end_reason, g.extends_grant_id
       FROM entitlement_grant g JOIN subscription s USING (subscription_id)
      WHERE s.account_id = $1 ORDER BY g.starts_at, g.grant_id`,
    [uuidOf(accountAlias)],
  );
}

/** Whether `principal` sees the account entitled to the feature now, through the check the assistant uses. */
export async function entitled(harness: Harness, accountAlias: string, featureKey: string) {
  return harness.application.withUseCases((useCases) =>
    useCases.checkEntitlement.execute({
      principalAccountId: uuidOf("iac_blair"),
      sessionId: null,
      caseId: null,
      toolCallId: null,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      accountId: uuidOf(accountAlias),
      featureKey,
    }),
  );
}

/** The outbox messages of a destination, oldest first. */
export async function outboxMessages(owner: PostgresConnection, destination = "approval-process") {
  return owner.query<{ message_type: string; aggregate_id: Uuid; delivered_at: Date | null }>(
    "SELECT message_type, aggregate_id, delivered_at FROM outbox_message WHERE destination = $1 ORDER BY created_at",
    [destination],
  );
}

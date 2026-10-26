import { FixedClock } from "../../../../adapter/clock/fixed-clock.ts";
import { UuidVersion7Generator } from "../../../../adapter/identifier/uuid-version7-generator.ts";
import { InMemoryMessageRateLimiter } from "../../../../adapter/message-rate-limiter/in-memory-message-rate-limiter.ts";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { RecordingSecurityEventLog } from "../../../../adapter/security-event-log/recording-security-event-log.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import { generateKeyPair, SignJWT } from "../../../../external/jose.ts";
import { encodeIdentifier, type IdentifierPrefix, type Uuid } from "../../../../kernel/identifier.ts";
import { importHashKey } from "../../../../subsystem/attribution/src/infra/audit-record-hash.ts";
import type { ReadRequest } from "../../../../subsystem/support/src/usecase/read-request.ts";
import type { CaseAgent, ConnectionSession } from "../../src/agent/case-agent.ts";
import { type Application, createApplication } from "../../src/application.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { loadBundledPolicySet } from "../../src/policy-set.ts";
import { TestConnection } from "./agent-connection.ts";
import type { ScriptedLanguageModel } from "./scripted-language-model.ts";

export const HOST = "app.entitlement-assistant.example";
export const ORIGIN = `https://${HOST}`;
export const AUDIT_KEY = "dGVzdC1hdWRpdC1oYXNoLWtleS1vZi0zMi1ieXRlcy1sb25nIQ";
export const IDENTIFIER_KEY = "dGVzdC1pZGVudGlmaWVyLWhhc2gta2V5LTMyLWJ5dGVzLWxvbmch";

/** The external form of a seeded alias: `iac_alex` → `iac_` + 22 characters. */
export function external(alias: string): string {
  const prefix = alias.slice(0, alias.indexOf("_")) as IdentifierPrefix;
  return encodeIdentifier(prefix, seededUuid(alias));
}

export function uuidOf(alias: string): Uuid {
  return seededUuid(alias);
}

export function at(time: string, date = "2026-10-22"): Date {
  return new Date(`${date}T${time}Z`);
}

export interface Harness {
  readonly application: Application;
  readonly clock: FixedClock;
  readonly securityEvents: RecordingSecurityEventLog;
  readonly signingKey: CryptoKey;
  readonly owner: PostgresConnection;
  readonly rateLimiter: InMemoryMessageRateLimiter;
  /** Every upgrade the application handed to a case agent. */
  readonly forwardedUpgrades: readonly { readonly caseId: Uuid; readonly session: ConnectionSession }[];
  readonly close: () => Promise<void>;
}

/** A fresh database, the real application, a fixed clock at 2026-10-22T15:00:00Z, and test keys. */
export async function createHarness(): Promise<Harness> {
  const database: TestDatabase = await createTestDatabase();
  const clock = new FixedClock(at("15:00:00"));
  const securityEvents = new RecordingSecurityEventLog();
  const forwardedUpgrades: { caseId: Uuid; session: ConnectionSession }[] = [];
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const owner = await PostgresConnection.open(database.connectionString);
  const application = createApplication({
    applicationOrigin: ORIGIN,
    openDatabase: () => PostgresConnection.open(database.connectionString),
    clock,
    idGenerator: new UuidVersion7Generator(),
    securityEventLog: securityEvents,
    sessionSigningKey: { keyId: "session-key-1", privateKey, publicKey },
    auditHashKey: { keyId: "audit-key-1", key: await importHashKey(AUDIT_KEY) },
    identifierHashKey: await importHashKey(IDENTIFIER_KEY),
    policySet: await loadBundledPolicySet(),
    forwardToCaseAgent: async (_request, caseId, session) => {
      forwardedUpgrades.push({ caseId, session });
      return new Response(null, { status: 204 });
    },
  });
  return {
    application,
    clock,
    securityEvents,
    signingKey: privateKey,
    owner,
    rateLimiter: new InMemoryMessageRateLimiter(),
    forwardedUpgrades,
    close: async () => {
      await owner.close();
      await database.drop();
    },
  };
}

export interface TokenClaims {
  readonly sub?: string;
  readonly sid?: string;
  readonly iss?: string;
  readonly aud?: string;
  readonly authTime: Date;
  readonly iat: Date;
  readonly exp: Date;
  readonly jti?: string;
}

/** A session token signed with `key`, with every claim chosen by the test. */
export async function mintToken(key: CryptoKey, claims: TokenClaims): Promise<string> {
  const seconds = (instant: Date) => Math.floor(instant.getTime() / 1000);
  return new SignJWT({
    sid: claims.sid ?? encodeIdentifier("ses", seededUuid("session-s")),
    auth_time: seconds(claims.authTime),
  })
    .setProtectedHeader({ alg: "ES256", kid: "session-key-1" })
    .setIssuer(claims.iss ?? "entitlement-assistant")
    .setAudience(claims.aud ?? "entitlement-assistant")
    .setSubject(claims.sub ?? external("iac_alex"))
    .setIssuedAt(seconds(claims.iat))
    .setExpirationTime(seconds(claims.exp))
    .setJti(claims.jti ?? encodeIdentifier("jti", seededUuid("token-j")))
    .sign(key);
}

export function decodePart(token: string, index: 0 | 1): Record<string, unknown> {
  const part = token.split(".")[index] ?? "";
  const json = atob(
    part
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(part.length / 4) * 4, "="),
  );
  return JSON.parse(json) as Record<string, unknown>;
}

export interface SessionCookie {
  readonly name: string;
  readonly value: string;
  readonly attributes: ReadonlyMap<string, string | true>;
}

export function parseSetCookie(header: string | null): SessionCookie | null {
  if (header === null) return null;
  const [pair = "", ...attributeParts] = header.split(";").map((part) => part.trim());
  const separator = pair.indexOf("=");
  const attributes = new Map<string, string | true>();
  for (const part of attributeParts) {
    const index = part.indexOf("=");
    if (index < 0) attributes.set(part.toLowerCase(), true);
    else attributes.set(part.slice(0, index).toLowerCase(), part.slice(index + 1));
  }
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1), attributes };
}

export interface AuditRecordView {
  readonly sequence_number: string;
  readonly action_key: string;
  readonly actor_account_id: string | null;
  readonly subject_account_id: string | null;
  readonly case_id: string | null;
  readonly policy_set_version: string | null;
  readonly audit_outcome: string;
  readonly session_id: string | null;
  readonly detail: Record<string, unknown>;
  readonly reasons: readonly string[];
  readonly row_json: string;
}

/** Every audit record, in chain order, with its reasons. */
export async function auditRecords(owner: PostgresConnection): Promise<readonly AuditRecordView[]> {
  return owner.query<AuditRecordView & Record<string, unknown>>(
    `SELECT r.sequence_number, r.action_key, r.actor_account_id, r.subject_account_id, r.case_id,
            r.policy_set_version, r.audit_outcome, r.session_id, r.detail,
            coalesce(array_agg(a.reason_code ORDER BY a.reason_code) FILTER (WHERE a.reason_code IS NOT NULL), '{}') AS reasons,
            row_to_json(r)::text AS row_json
       FROM audit_chain_record r LEFT JOIN audit_reason a USING (audit_chain_record_id)
      GROUP BY r.audit_chain_record_id ORDER BY r.sequence_number`,
  );
}

/** Places a hold the way a Given states it, straight in the tables (the hold use case is not part of this feature). */
export async function placeHold(
  owner: PostgresConnection,
  accountAlias: string,
  reason: string,
  placedAt: Date,
): Promise<void> {
  await owner.query(
    `INSERT INTO account_hold (hold_id, account_id, hold_reason, placed_at, placed_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
    [uuidOf(accountAlias), reason, placedAt, uuidOf("iac_sam")],
  );
  await owner.query("UPDATE account SET account_status = 'Suspended' WHERE account_id = $1", [
    uuidOf(accountAlias),
  ]);
}

export function request(
  method: string,
  path: string,
  init: { readonly headers?: Record<string, string>; readonly body?: string } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: init.headers ?? {},
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

export function compact(json: unknown): string {
  return JSON.stringify(json);
}

/** The request of a `[use-case]` scenario: the principal, and nothing a session or case would add. */
export function readRequest(principalAlias: string): ReadRequest {
  return {
    principalAccountId: uuidOf(principalAlias),
    sessionId: null,
    caseId: null,
    toolCallId: null,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  };
}

/** Opens a case directly in the tables, the way a Given states it (assigned to `assigneeAlias`). */
export async function insertCase(
  owner: PostgresConnection,
  caseAlias: string,
  assigneeAlias: string,
  at: Date,
): Promise<void> {
  await owner.query("INSERT INTO support_case (case_id, opened_at, opened_by) VALUES ($1, $2, $3)", [
    uuidOf(caseAlias),
    at,
    uuidOf(assigneeAlias),
  ]);
  await owner.query(
    `INSERT INTO case_assignment (assignment_id, case_id, assignee_account_id, assigned_at, assigned_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $2)`,
    [uuidOf(caseAlias), uuidOf(assigneeAlias), at],
  );
}

/** A case agent for one case, with the scripted model and an in-process rate limiter. */
export function caseAgentFor(harness: Harness, caseAlias: string, model: ScriptedLanguageModel): CaseAgent {
  return harness.application.createCaseAgent(uuidOf(caseAlias), {
    languageModel: model,
    rateLimiter: harness.rateLimiter,
  });
}

/** Connects to a case agent with a verified session of `principalAlias` expiring at `expiresAt`. */
export async function connectAs(
  agent: CaseAgent,
  principalAlias: string,
  expiresAt: Date,
  connectionId = `connection-${principalAlias}`,
): Promise<TestConnection> {
  const connection = new TestConnection(connectionId);
  await agent.connect(connection, {
    principalAccountId: uuidOf(principalAlias),
    sessionId: seededUuid(`session-${connectionId}`),
    expiresAt,
  });
  return connection;
}

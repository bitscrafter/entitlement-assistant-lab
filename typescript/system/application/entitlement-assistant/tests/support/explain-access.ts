import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EntitlementSource } from "../../../../subsystem/support/src/usecase/read-request.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { type AuditRecordView, at, auditRecords, external, mintToken } from "./harness.ts";

const FIXTURES = fileURLToPath(new URL("../../resource/seed/fixtures.yaml", import.meta.url));

/** Every alias the fixtures and the specs use, by the UUID it stands for. */
const ALIAS_OF: ReadonlyMap<string, string> = (() => {
  const names = new Set(readFileSync(FIXTURES, "utf8").match(/\b[a-z]+_[a-z0-9_]+\b/g) ?? []);
  for (const extra of ["cse_alex_1", "cse_alex_2", "cse_blair_1", "cse_missing"]) names.add(extra);
  return new Map([...names].map((name) => [seededUuid(name), name]));
})();

function aliasOf(uuid: string | null): string | null {
  return uuid === null ? null : (ALIAS_OF.get(uuid as Uuid) ?? uuid);
}

/** An audit record as the specs write it: aliases instead of UUIDs, and only the fields the specs name. */
export interface SpecAuditRecord {
  readonly action_key: string;
  readonly actor: string | null;
  readonly subject: string | null;
  readonly audit_outcome: string;
  readonly reasons: readonly string[];
  readonly detail: Readonly<Record<string, unknown>>;
  readonly case: string | null;
  readonly policy_set_version: string | null;
}

export async function specAuditRecords(harness: {
  readonly owner: PostgresConnection;
}): Promise<readonly SpecAuditRecord[]> {
  return (await auditRecords(harness.owner)).map((record: AuditRecordView) => ({
    action_key: record.action_key,
    actor: aliasOf(record.actor_account_id),
    subject: aliasOf(record.subject_account_id),
    audit_outcome: record.audit_outcome,
    reasons: record.reasons,
    detail: record.detail,
    case: aliasOf(record.case_id),
    policy_set_version: record.policy_set_version,
  }));
}

/** `plan:business`, `addon:advanced-analytics`, `grant:grt_hooli_seats` as written in the specs. */
export function source(written: string): EntitlementSource {
  const [kind = "", key = ""] = written.split(":");
  if (kind === "plan") return { kind: "plan", planKey: key };
  if (kind === "addon") return { kind: "addon", addonKey: key };
  if (kind === "grant") return { kind: "grant", grantId: seededUuid(key) };
  throw new Error(`Unknown source ${written}`);
}

/** A session token of `alias`, issued at 14:50:00 and expiring at 15:20:00 (the specs' valid token). */
export function validToken(
  harness: { readonly signingKey: CryptoKey },
  alias: string,
  exp = at("15:20:00"),
): Promise<string> {
  return mintToken(harness.signingKey, {
    sub: external(alias),
    authTime: at("14:50:00"),
    iat: at("14:50:00"),
    exp,
  });
}

export function day(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

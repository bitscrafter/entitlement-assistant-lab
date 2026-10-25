import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FixedClock } from "../../../adapter/clock/fixed-clock.ts";
import { UuidVersion7Generator } from "../../../adapter/identifier/uuid-version7-generator.ts";
import {
  APPLICATION_DATABASE_ROLE,
  PostgresConnection,
} from "../../../adapter/postgres/postgres-connection.ts";
import { PostgresUnitOfWork } from "../../../adapter/postgres/postgres-unit-of-work.ts";
import { createTestDatabase, type TestDatabase } from "../../../adapter/tests/support/database.ts";
import type { Uuid } from "../../../kernel/identifier.ts";
import type { AuditEntry } from "../../../port/audit-recorder.ts";
import { importHashKey } from "../src/infra/audit-record-hash.ts";
import { verifyAuditChain } from "../src/infra/postgres-audit-chain-verifier.ts";
import { PostgresAuditRecorder } from "../src/infra/postgres-audit-recorder.ts";

const KEY = "dGVzdC1hdWRpdC1oYXNoLWtleS1vZi0zMi1ieXRlcy1sb25nIQ";
const ACTOR = "01928f3a-7b5c-7d2e-9f10-a1b2c3d4e5f6" as Uuid;
const CONTACT = "01928f3a-7b5c-7d2e-9f10-a1b2c3d4e5f7" as Uuid;

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actorAccountId: ACTOR,
    sessionId: null,
    traceId: "0af7651916cd43dd8448eb211c80319c",
    actionKey: "session.sign-in",
    outcome: "Succeeded",
    policySetVersion: null,
    subjectAccountId: null,
    caseId: null,
    changeRequestId: null,
    detail: {},
    participants: [],
    reasons: [],
    ...overrides,
  };
}

describe("PostgresAuditRecorder", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;
  let unitOfWork: PostgresUnitOfWork;
  let recorder: PostgresAuditRecorder;
  let keys: Map<string, CryptoKey>;

  beforeEach(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
    unitOfWork = new PostgresUnitOfWork(connection, { role: APPLICATION_DATABASE_ROLE });
    const key = await importHashKey(KEY);
    keys = new Map([["audit-key-1", key]]);
    recorder = new PostgresAuditRecorder({
      connection,
      unitOfWork,
      idGenerator: new UuidVersion7Generator(),
      clock: new FixedClock(new Date("2026-10-22T15:00:00Z")),
      hashKey: { keyId: "audit-key-1", key },
    });
  });

  afterEach(async () => {
    await connection.close();
    await database.drop();
  });

  test("ensures records form a gapless chain that verifies", async () => {
    await recorder.record(entry());
    await recorder.record(
      entry({
        participants: [{ role: "Contact", accountId: CONTACT }],
        reasons: ["session.invalid-credentials"],
        outcome: "Failed",
        actorAccountId: null,
      }),
    );
    await recorder.record(
      entry({ detail: { tool: "explain_access", nested: { values: [1, "two", null] } } }),
    );
    const sequence = await connection.query<{ sequence_number: string }>(
      "SELECT sequence_number FROM audit_chain_record ORDER BY sequence_number",
    );
    expect(sequence.map((row) => row.sequence_number)).toEqual(["1", "2", "3"]);
    expect(await verifyAuditChain(connection, keys)).toEqual({ intact: true, records: 3 });
  });

  test("ensures the record rolls back with the caller's transaction", async () => {
    const work = unitOfWork.run(async () => {
      await recorder.record(entry());
      throw new Error("the audited action failed");
    });
    await expect(work).rejects.toThrow("the audited action failed");
    expect(await connection.query("SELECT 1 FROM audit_chain_record")).toEqual([]);
    const [head] = await connection.query<{ last_sequence_number: string }>(
      "SELECT last_sequence_number FROM audit_chain_head",
    );
    expect(head?.last_sequence_number).toBe("0");
  });

  test("ensures a record that cannot be written rejects (rule audit-fails-closed)", async () => {
    await expect(
      recorder.record(entry({ actionKey: "account.read", actorAccountId: null })),
    ).rejects.toThrow();
    await expect(recorder.record(entry({ reasons: ["unknown.namespace"] }))).rejects.toThrow();
  });

  test("ensures any alteration is detected at the first altered record", async () => {
    await recorder.record(entry());
    await recorder.record(entry({ detail: { tool: "check_entitlement" } }));
    await recorder.record(entry());
    // Outside a unit of work the connection acts as the database owner: someone with direct access.
    await connection.query(
      `UPDATE audit_chain_record SET detail = '{"tool":"forged"}' WHERE sequence_number = 2`,
    );
    expect(await verifyAuditChain(connection, keys)).toEqual({ intact: false, firstMismatch: 2 });
  });

  test("ensures the application's role can neither update nor delete audit records", async () => {
    await recorder.record(entry());
    const asApplication = (sql: string) => unitOfWork.run(() => connection.query(sql));
    await expect(asApplication("UPDATE audit_chain_record SET action_key = 'session.renew'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(asApplication("DELETE FROM audit_chain_record")).rejects.toThrow(/permission denied/);
    await expect(asApplication("DELETE FROM audit_reason")).rejects.toThrow(/permission denied/);
  });
});

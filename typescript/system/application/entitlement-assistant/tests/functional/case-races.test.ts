import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { accountIdOf, caseIdOf, givenCase } from "../support/case-lifecycle.ts";
import { validToken } from "../support/explain-access.ts";
import { at, createHarness, type Harness, insertCase, ORIGIN, request, uuidOf } from "../support/harness.ts";

/**
 * Concurrent actions on one case (adversarial review R1, R2): whatever the order the database serializes them in,
 * a case's state is the state its actions decided on. Each race runs several times on fresh cases.
 */
describe("case actions racing on one case", () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness.close();
  });

  const act = async (method: "PUT" | "POST", caseAlias: string, action: string, body: unknown) =>
    harness.application.fetch(
      request(method, `/api/cases/${caseIdOf(caseAlias)}/${action}`, {
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/json",
          Cookie: `__Host-session=${await validToken(harness, "iac_alex")}`,
        },
        body: JSON.stringify(body),
      }),
    );
  const recordsOf = (caseAlias: string) =>
    harness.owner.query<{ action_key: string; audit_outcome: string; subject_account_id: string | null }>(
      `SELECT action_key, audit_outcome, subject_account_id FROM audit_chain_record
        WHERE case_id = $1 ORDER BY sequence_number`,
      [uuidOf(caseAlias)],
    );
  const rowOf = async (caseAlias: string) =>
    (
      await harness.owner.query<{
        subject_account_id: string | null;
        contact_account_id: string | null;
        contact_authenticated_at: Date | null;
        closed_at: Date | null;
      }>(
        `SELECT subject_account_id, contact_account_id, contact_authenticated_at, closed_at
           FROM support_case WHERE case_id = $1`,
        [uuidOf(caseAlias)],
      )
    )[0];

  test.each(Array.from({ length: 8 }, (_, run) => run))(
    "invariant a closed case's subject is the one its closing decided on (run %i)",
    async (run) => {
      const caseAlias = `cse_race_close_${run}`;
      await insertCase(harness.owner, caseAlias, "iac_alex", at("14:00:00"));

      const [closing, setting] = await Promise.all([
        act("POST", caseAlias, "closure", { close_reason: "Resolved", summary: "Done." }),
        act("PUT", caseAlias, "subject", { account_id: accountIdOf("acc_acme") }),
      ]);

      expect(closing.status).toBe(204);
      expect([204, 404]).toContain(setting.status);
      const row = await rowOf(caseAlias);
      const closeRecords = (await recordsOf(caseAlias)).filter(
        (record) => record.action_key === "case.close",
      );
      expect(closeRecords.map((record) => record.subject_account_id)).toEqual([
        row?.subject_account_id ?? null,
        row?.subject_account_id ?? null,
      ]);
      expect(row?.subject_account_id ?? null).toBe(setting.status === 204 ? uuidOf("acc_acme") : null);
    },
  );

  test.each(Array.from({ length: 8 }, (_, run) => run))(
    "invariant an authentication is recorded for the contact it was decided on (run %i)",
    async (run) => {
      const caseAlias = `cse_race_contact_${run}`;
      await insertCase(harness.owner, caseAlias, "iac_alex", at("14:00:00"));
      await givenCase(harness.owner, caseAlias, { subject: "acc_acme", contact: "acc_jane" });

      await Promise.all([
        act("PUT", caseAlias, "contact", { account_id: accountIdOf("acc_bob") }),
        act("POST", caseAlias, "contact-authentication", {
          kind: "Knowledge",
          method: "SecurityQuestion",
          passed: true,
        }),
      ]);

      const row = await rowOf(caseAlias);
      expect(row?.contact_account_id).toBe(uuidOf("acc_bob"));
      if (row?.contact_authenticated_at !== null) {
        const authenticated = (await recordsOf(caseAlias)).filter(
          (record) =>
            record.action_key === "case.authenticate-contact" && record.audit_outcome === "Succeeded",
        );
        expect(authenticated.map((record) => record.subject_account_id)).toEqual([uuidOf("acc_bob")]);
      }
    },
  );
});

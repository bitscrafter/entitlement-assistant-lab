import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  accountIdOf,
  caseIdOf,
  casePath,
  caseRequest,
  caseState,
  conflict,
  givenCase,
  invalidRequest,
  lifecycleRecords,
} from "../../support/case-lifecycle.ts";
import { at, createHarness, type Harness, insertCase, placeHold, uuidOf } from "../../support/harness.ts";

const stated = (records: Awaited<ReturnType<typeof lifecycleRecords>>) =>
  records.map(({ action_key, actor, subject, audit_outcome, reasons, case: caseAlias }) => ({
    action_key,
    actor,
    subject,
    audit_outcome,
    reasons,
    case: caseAlias,
  }));

const record = (actionKey: string, subject: string, outcome: string, reasons: string[] = []) => ({
  action_key: actionKey,
  actor: "iac_alex",
  subject,
  audit_outcome: outcome,
  reasons,
  case: "cse_alex_1",
});

const ACME_SUBJECT = {
  account_id: accountIdOf("acc_acme"),
  readable: true,
  display_name: "Acme Corp",
  holds: [],
};
const JANE_CONTACT = {
  account_id: accountIdOf("acc_jane"),
  readable: true,
  display_name: "Jane Doe",
  holds: [],
  roles_in_subject: ["admin", "billing"],
};

describe("case-lifecycle the contact and its authentication", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
    await insertCase(harness.owner, "cse_alex_1", "iac_alex", at("14:00:00"));
  });
  afterEach(async () => {
    await harness.close();
  });

  const setContact = (account: string) =>
    caseRequest(harness, "PUT", casePath("cse_alex_1", "contact"), "iac_alex", {
      account_id: accountIdOf(account),
    });
  const authenticate = (body: unknown) =>
    caseRequest(harness, "POST", casePath("cse_alex_1", "contact-authentication"), "iac_alex", body);
  const readCase = async (tokenExpiresAt = at("15:20:00")) => {
    const response = await caseRequest(
      harness,
      "GET",
      casePath("cse_alex_1"),
      "iac_alex",
      undefined,
      tokenExpiresAt,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  };

  test("scenario 27a ensures the CSR sets the contact", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });

    const response = await setContact("acc_jane");

    expect(response.status).toBe(204);
    expect(stated(await lifecycleRecords(harness))).toEqual([
      record("case.set-contact", "acc_jane", "Allow"),
      record("case.set-contact", "acc_jane", "Succeeded"),
    ]);
    expect((await readCase()).contact).toEqual(JANE_CONTACT);
  });

  test("scenario 27b ensures a contact is a person's own account", async () => {
    const response = await setContact("acc_acme");

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      invalidRequest("account_id", "The contact must be a person's own account."),
    );
    expect((await caseState(harness.owner, "cse_alex_1")).row?.contact_account_id).toBeNull();
    expect(stated(await lifecycleRecords(harness))).toEqual([
      record("case.set-contact", "acc_acme", "Allow"),
      record("case.set-contact", "acc_acme", "Failed", ["support.contact-not-a-person"]),
    ]);
  });

  test("scenario 27c ensures the CSR records a passed authentication", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme", contact: "acc_jane" });

    const response = await authenticate({ kind: "Knowledge", method: "SecurityQuestion", passed: true });

    expect(response.status).toBe(204);
    const { row } = await caseState(harness.owner, "cse_alex_1");
    expect(row).toMatchObject({
      contact_authenticated_at: at("15:00:00"),
      contact_authentication_kind: "Knowledge",
      contact_authentication_method: "SecurityQuestion",
      contact_authenticated_by: uuidOf("iac_alex"),
    });
    expect(stated(await lifecycleRecords(harness))).toEqual([
      record("case.authenticate-contact", "acc_jane", "Allow"),
      record("case.authenticate-contact", "acc_jane", "Succeeded"),
    ]);
    expect((await readCase()).contact_authentication).toEqual({
      kind: "Knowledge",
      method: "SecurityQuestion",
      authenticated_by: accountIdOf("iac_alex"),
      authenticated_at: "2026-10-22T15:00:00.000Z",
      expires_at: "2026-10-22T15:30:00.000Z",
    });
  });

  describe("scenario 27d ensures a failed authentication is refused, audited, and clears the earlier one", () => {
    test("case A, the contact fails the check", async () => {
      await givenCase(harness.owner, "cse_alex_1", {
        subject: "acc_acme",
        contact: "acc_jane",
        authenticated: { at: at("14:50:00"), kind: "Knowledge", method: "SecurityQuestion", by: "iac_alex" },
      });

      const response = await authenticate({ kind: "Knowledge", method: "AccountDetails", passed: false });

      expect(response.status).toBe(409);
      expect(await response.text()).toBe(
        conflict("contact_authentication_failed", "The contact did not pass authentication."),
      );
      expect((await caseState(harness.owner, "cse_alex_1")).row).toMatchObject({
        contact_account_id: uuidOf("acc_jane"),
        contact_authenticated_at: null,
        contact_authentication_kind: null,
        contact_authentication_method: null,
        contact_authenticated_by: null,
      });
      expect(stated(await lifecycleRecords(harness))).toEqual([
        record("case.authenticate-contact", "acc_jane", "Allow"),
        record("case.authenticate-contact", "acc_jane", "Failed", ["support.contact-authentication-failed"]),
      ]);
    });

    test("case B, no contact is set", async () => {
      await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });

      const response = await authenticate({ kind: "Knowledge", method: "SecurityQuestion", passed: true });

      expect(response.status).toBe(409);
      expect(await response.text()).toBe(conflict("contact_not_set", "The case has no contact."));
      expect(stated(await lifecycleRecords(harness))).toEqual([
        { ...record("case.authenticate-contact", "", "Allow"), subject: null },
        { ...record("case.authenticate-contact", "", "Failed", ["support.contact-not-set"]), subject: null },
      ]);
    });

    test.each([
      { kind: "Possession", method: "OneTimeCode", description: "This method is not accepted." },
      { kind: "Knowledge", method: "SupportPasscode", description: "This method is not accepted." },
      { kind: "Knowledge", method: "OneTimeCode", description: "The method is not of this kind." },
      { kind: "Knowledge", method: "Password", description: "This method is not accepted." },
    ])(
      "case C, a method the demo does not accept, or not of its kind: $kind $method",
      async ({ kind, method, description }) => {
        await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme", contact: "acc_jane" });
        const before = await caseState(harness.owner, "cse_alex_1");

        const response = await authenticate({ kind, method, passed: true });

        expect(response.status).toBe(400);
        expect(await response.text()).toBe(invalidRequest("method", description));
        expect(await lifecycleRecords(harness)).toEqual([]);
        expect(await caseState(harness.owner, "cse_alex_1")).toEqual(before);
      },
    );
  });

  test("scenario 27e ensures changing the contact clears the authentication", async () => {
    await givenCase(harness.owner, "cse_alex_1", {
      subject: "acc_acme",
      contact: "acc_jane",
      authenticated: { at: at("14:50:00"), kind: "Knowledge", method: "SecurityQuestion", by: "iac_alex" },
    });

    const response = await setContact("acc_carol");

    expect(response.status).toBe(204);
    expect(stated(await lifecycleRecords(harness))).toEqual([
      record("case.set-contact", "acc_carol", "Allow"),
      record("case.set-contact", "acc_carol", "Succeeded"),
    ]);
    const read = await readCase();
    expect(read.contact).toEqual({
      account_id: accountIdOf("acc_carol"),
      readable: true,
      display_name: "Carol Diaz",
      holds: [],
      roles_in_subject: ["viewer"],
    });
    expect(read.contact_authentication).toBeNull();
  });

  test("scenario 27f ensures the case shows its state, the authentication's expiry included", async () => {
    await givenCase(harness.owner, "cse_alex_1", {
      subject: "acc_acme",
      contact: "acc_jane",
      authenticated: { at: at("14:50:00"), kind: "Knowledge", method: "SecurityQuestion", by: "iac_alex" },
    });
    const expected = {
      case_id: caseIdOf("cse_alex_1"),
      subject: ACME_SUBJECT,
      contact: JANE_CONTACT,
      contact_authentication: {
        kind: "Knowledge",
        method: "SecurityQuestion",
        authenticated_by: accountIdOf("iac_alex"),
        authenticated_at: "2026-10-22T14:50:00.000Z",
        expires_at: "2026-10-22T15:20:00.000Z",
      },
      opened_at: "2026-10-22T14:00:00.000Z",
      closed_at: null,
      close_reason: null,
      summary: null,
    };

    expect(await readCase(at("15:40:00"))).toEqual(expected);
    harness.clock.setTo(at("15:25:00"));
    expect(await readCase(at("15:40:00"))).toEqual(expected);

    const reads = (await lifecycleRecords(harness)).map((entry) => [
      entry.action_key,
      entry.subject,
      entry.audit_outcome,
      entry.detail.use_case,
    ]);
    expect(reads).toEqual([
      ["account.read", "acc_acme", "Allow", "GetCase"],
      ["account.read", "acc_jane", "Allow", "GetCase"],
      ["account.read", "acc_acme", "Allow", "GetCase"],
      ["account.read", "acc_jane", "Allow", "GetCase"],
    ]);
  });

  test("scenario 27g ensures an expired authentication is renewed by authenticating again", async () => {
    await givenCase(harness.owner, "cse_alex_1", {
      subject: "acc_acme",
      contact: "acc_jane",
      authenticated: { at: at("14:20:00"), kind: "Knowledge", method: "SecurityQuestion", by: "iac_alex" },
    });

    const response = await authenticate({ kind: "Knowledge", method: "AccountDetails", passed: true });

    expect(response.status).toBe(204);
    expect(stated(await lifecycleRecords(harness))).toEqual([
      record("case.authenticate-contact", "acc_jane", "Allow"),
      record("case.authenticate-contact", "acc_jane", "Succeeded"),
    ]);
    expect((await readCase()).contact_authentication).toEqual({
      kind: "Knowledge",
      method: "AccountDetails",
      authenticated_by: accountIdOf("iac_alex"),
      authenticated_at: "2026-10-22T15:00:00.000Z",
      expires_at: "2026-10-22T15:30:00.000Z",
    });
  });

  test("scenario 27h ensures the contact can be the subject itself", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_jane" });

    const response = await setContact("acc_jane");

    expect(response.status).toBe(204);
    expect(stated(await lifecycleRecords(harness))).toEqual([
      record("case.set-contact", "acc_jane", "Allow"),
      record("case.set-contact", "acc_jane", "Succeeded"),
    ]);
    expect((await readCase()).contact).toEqual({ ...JANE_CONTACT, roles_in_subject: ["owner"] });
  });

  test("scenario 27i ensures a contact on hold can be set, and the case shows the hold", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });
    await placeHold(harness.owner, "acc_jane", "OperationalSuspension", at("14:00:00"));

    const response = await setContact("acc_jane");

    expect(response.status).toBe(204);
    expect((await readCase()).contact).toEqual({
      ...JANE_CONTACT,
      holds: ["account.operational-suspension"],
    });
  });

  test("scenario 27j ensures a contact with no role in the subject can be set, and the case shows it", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme" });

    const response = await setContact("acc_bob");

    expect(response.status).toBe(204);
    expect((await readCase()).contact).toEqual({
      account_id: accountIdOf("acc_bob"),
      readable: true,
      display_name: "Bob Green",
      holds: [],
      roles_in_subject: [],
    });
  });

  test("scenario 27k ensures the case shows only what the CSR may read", async () => {
    await givenCase(harness.owner, "cse_alex_1", { subject: "acc_acme", contact: "acc_jane" });
    await harness.owner.query(
      `UPDATE subscription_term SET plan_key = 'enterprise'
        WHERE ended_at IS NULL AND subscription_id IN (SELECT subscription_id FROM subscription WHERE account_id = $1)`,
      [uuidOf("acc_acme")],
    );

    expect(await readCase()).toEqual({
      case_id: caseIdOf("cse_alex_1"),
      subject: { account_id: accountIdOf("acc_acme"), readable: false },
      // Her roles are facts about acc_acme, which iac_alex may not read (discovery 1).
      contact: { ...JANE_CONTACT, roles_in_subject: null },
      contact_authentication: null,
      opened_at: "2026-10-22T14:00:00.000Z",
      closed_at: null,
      close_reason: null,
      summary: null,
    });
    expect(
      (await lifecycleRecords(harness)).map((entry) => [
        entry.action_key,
        entry.subject,
        entry.audit_outcome,
        entry.reasons,
        entry.detail.use_case,
      ]),
    ).toEqual([
      ["account.read", "acc_acme", "Deny", ["policy.enterprise-accounts-need-level-2"], "GetCase"],
      ["account.read", "acc_jane", "Allow", [], "GetCase"],
    ]);
  });
});

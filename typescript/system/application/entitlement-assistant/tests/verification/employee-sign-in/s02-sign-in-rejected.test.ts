import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  auditRecords,
  compact,
  createHarness,
  type Harness,
  ORIGIN,
  request,
} from "../../support/harness.ts";

const BODY = compact({
  error: "invalid_credentials",
  error_description: "The email or password is incorrect.",
});

const cases = [
  {
    letter: "A",
    name: "wrong password",
    email: "alex@provider.example",
    password: "wrong-password",
    reasons: ["session.invalid-credentials"],
  },
  {
    letter: "B",
    name: "unknown email",
    email: "nobody@provider.example",
    password: "alex-demo-password",
    reasons: ["session.invalid-credentials"],
  },
  {
    letter: "C",
    name: "empty password",
    email: "alex@provider.example",
    password: "",
    reasons: ["session.invalid-credentials"],
  },
  {
    letter: "D",
    name: "inactive identity, correct password",
    email: "casey@provider.example",
    password: "casey-demo-password",
    reasons: ["account.internal-identity-inactive", "session.invalid-credentials"],
  },
  {
    letter: "E",
    name: "suspended account, correct password",
    email: "dana@provider.example",
    password: "dana-demo-password",
    reasons: ["account.operational-suspension", "session.invalid-credentials"],
  },
] as const;

describe("employee-sign-in", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test.each(cases)(
    "scenario 02 requires valid credentials without revealing which part was wrong — case $letter $name",
    async ({ email, password, reasons }) => {
      const response = await harness.application.fetch(
        request("POST", "/api/authentication/sign-in", {
          headers: { Origin: ORIGIN, "Content-Type": "application/json" },
          body: compact({ email, password }),
        }),
      );

      expect(response.status).toBe(401);
      expect(Object.fromEntries(response.headers)).toEqual({
        "cache-control": "no-store",
        "content-length": String(BODY.length),
        "content-type": "application/json",
        "strict-transport-security": "max-age=31536000; includeSubDomains",
      });
      expect(await response.text()).toBe(BODY);

      const records = await auditRecords(harness.owner);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action_key: "session.sign-in",
        actor_account_id: null,
        audit_outcome: "Failed",
        reasons,
      });
      expect(records[0]?.detail.attempted_identifier_hmac).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(records[0]?.row_json).not.toContain(email);
    },
  );
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { generateKeyPair } from "../../../../../external/jose.ts";
import type { SecurityEventCause } from "../../../../../port/security-event-log.ts";
import {
  at,
  auditRecords,
  compact,
  createHarness,
  external,
  type Harness,
  mintToken,
  request,
} from "../../support/harness.ts";

const BODY = compact({ error: "invalid_session", error_description: "A valid session is required." });
const T = { authTime: at("14:50:00"), iat: at("14:50:00"), exp: at("15:20:00") };

function replacePayload(token: string, change: (claims: Record<string, unknown>) => void): string {
  const [header, payload, signature] = token.split(".");
  const json = JSON.parse(atob((payload ?? "").replaceAll("-", "+").replaceAll("_", "/"))) as Record<
    string,
    unknown
  >;
  change(json);
  const encoded = btoa(JSON.stringify(json)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${header}.${encoded}.${signature}`;
}

function unsigned(token: string): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" })).replace(/=+$/, "");
  return `${header}.${token.split(".")[1]}.`;
}

type Case = {
  readonly letter: string;
  readonly name: string;
  readonly cause: SecurityEventCause;
  readonly token: (harness: Harness) => Promise<string | null>;
};

const cases: readonly Case[] = [
  { letter: "A", name: "no token", cause: "NoSession", token: async () => null },
  {
    letter: "B",
    name: "expired token",
    cause: "Expired",
    token: (harness) => mintToken(harness.signingKey, { ...T, exp: at("14:59:59") }),
  },
  {
    letter: "C",
    name: "altered payload",
    cause: "InvalidSignature",
    token: async (harness) =>
      replacePayload(await mintToken(harness.signingKey, T), (claims) => {
        claims.sub = external("iac_blair");
      }),
  },
  {
    letter: "D",
    name: "unsigned token",
    cause: "UnsupportedAlgorithm",
    token: async (harness) => unsigned(await mintToken(harness.signingKey, T)),
  },
  {
    letter: "E",
    name: "unknown signing key",
    cause: "InvalidSignature",
    token: async () => mintToken((await generateKeyPair("ES256")).privateKey, T),
  },
  {
    letter: "F",
    name: "wrong issuer",
    cause: "WrongIssuer",
    token: (harness) => mintToken(harness.signingKey, { ...T, iss: "someone-else" }),
  },
  {
    letter: "G",
    name: "wrong audience",
    cause: "WrongAudience",
    token: (harness) => mintToken(harness.signingKey, { ...T, aud: "someone-else" }),
  },
  {
    letter: "H",
    name: "account suspended after sign-in",
    cause: "PrincipalInactive",
    token: (harness) => mintToken(harness.signingKey, { ...T, sub: external("iac_dana") }),
  },
];

describe("employee-sign-in", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  test.each(cases)(
    "scenario 03 requires a valid token for a valid principal — case $letter $name",
    async ({ token, cause }) => {
      const value = await token(harness);
      const response = await harness.application.fetch(
        request(
          "GET",
          "/api/authentication/session",
          value === null ? {} : { headers: { Cookie: `__Host-session=${value}` } },
        ),
      );

      expect(response.status).toBe(401);
      expect(Object.fromEntries(response.headers)).toEqual({
        "cache-control": "no-store",
        "content-length": String(BODY.length),
        "content-type": "application/json",
        "strict-transport-security": "max-age=31536000; includeSubDomains",
      });
      expect(await response.text()).toBe(BODY);
      expect(await auditRecords(harness.owner)).toEqual([]);
      expect(harness.securityEvents.events.map((event) => event.cause)).toEqual([cause]);
    },
  );
});

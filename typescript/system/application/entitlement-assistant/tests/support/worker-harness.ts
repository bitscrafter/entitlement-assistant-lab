import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import { generateKeyPair } from "../../../../external/jose.ts";
import { encodeIdentifier } from "../../../../kernel/identifier.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { AgentConversation } from "./agent-connection.ts";
import { AUDIT_KEY, at, external, IDENTIFIER_KEY, mintToken, ORIGIN } from "./harness.ts";
import { type RawUpgradeResponse, rawUpgrade } from "./raw-websocket.ts";
import type { ScriptedStep } from "./scripted-language-model.ts";

const ENTRY = fileURLToPath(new URL("../e2e/worker-under-test.ts", import.meta.url));

/** The scripted model of explain-access S13: a check of Acme's SSO, then the reply. */
const SPEC_SCRIPT: readonly ScriptedStep[] = [
  {
    text: "",
    toolCalls: [
      {
        toolCallId: "call_1",
        toolName: "check_entitlement",
        arguments: { account_id: external("acc_acme"), feature_key: "sso" },
      },
    ],
  },
  { text: "Yes. Acme Corp has SSO through its Business plan.", toolCalls: [] },
];

type TestServer = ReturnType<typeof createTestHarness>;
/** Miniflare's request options and response: a `101` response carries the accepted `webSocket`. */
type WorkerFetch = (
  path: string,
  init?: Parameters<TestServer["fetch"]>[1],
) => ReturnType<TestServer["fetch"]>;

export interface WorkerHarness {
  /** Dispatches a request to the Worker; its URL is the application's origin. */
  readonly fetch: WorkerFetch;
  /** Runs a test control inside the case's agent: `clock`, `script`, `security-events`, `close-expired`. */
  readonly control: (action: string, caseAlias: string, body?: string) => Promise<string>;
  /** Connects to a case's agent as `principalAlias`, with a token issued at `issuedAt` and expiring at `expiresAt`. */
  readonly connectAgent: (
    caseAlias: string,
    principalAlias: string,
    token?: { readonly issuedAt: Date; readonly expiresAt: Date } | { readonly sessionToken: string },
  ) => Promise<AgentConversation>;
  readonly signingKey: CryptoKey;
  readonly owner: PostgresConnection;
  readonly close: () => Promise<void>;
}

/**
 * The application running in the Workers runtime against a fresh database, at the specs' fixed instant, with the
 * scripted model playing `script` (by default, explain-access S13's exchange).
 */
export async function createWorkerHarness(
  script: readonly ScriptedStep[] = SPEC_SCRIPT,
): Promise<WorkerHarness> {
  const database: TestDatabase = await createTestDatabase();
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
  const server = createTestHarness({
    workers: [
      {
        config: {
          name: "entitlement-assistant-under-test",
          main: ENTRY,
          compatibility_date: "2026-10-20",
          compatibility_flags: ["nodejs_compat"],
          hyperdrive: [
            {
              binding: "HYPERDRIVE",
              id: "00000000000000000000000000000000",
              localConnectionString: database.connectionString,
            },
          ],
          durable_objects: {
            bindings: [
              { name: "CASE_AGENT", class_name: "CaseAgentObject" },
              { name: "MESSAGE_RATE_LIMITER", class_name: "MessageRateLimiterObject" },
            ],
          },
          migrations: [{ tag: "v1", new_sqlite_classes: ["CaseAgentObject", "MessageRateLimiterObject"] }],
          vars: {
            TEST_LANGUAGE_MODEL_SCRIPT: JSON.stringify(script),
            TEST_APPLICATION_ORIGIN: ORIGIN,
            TEST_SESSION_SIGNING_KEY: JSON.stringify(privateJwk),
            TEST_AUDIT_HASH_KEY: AUDIT_KEY,
            TEST_IDENTIFIER_HASH_KEY: IDENTIFIER_KEY,
          },
        },
      },
    ],
  });
  const { url: serverUrl } = await server.listen();
  const owner = await PostgresConnection.open(database.connectionString);
  const fetchWorker = ((path: string, init?: Parameters<WorkerFetch>[1]) => {
    const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
    // An upgrade goes over a raw connection, so the test sees the Worker's own handshake (RFC 6455 §4.2.2).
    if (headers.get("upgrade")?.toLowerCase() === "websocket") {
      return rawUpgrade(serverUrl, path, Object.fromEntries(headers));
    }
    // Over real HTTP as well: the in-process dispatcher rewrites the request's URL and Origin to plain HTTP.
    return fetch(new URL(path, serverUrl), init as unknown as RequestInit);
  }) as unknown as WorkerFetch;
  return {
    fetch: fetchWorker,
    control: async (action, caseAlias, body) => {
      const response = await server.fetch(`${ORIGIN}/__test/${action}?case=${seededUuid(caseAlias)}`, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { body }),
      });
      return response.text();
    },
    connectAgent: async (
      caseAlias,
      principalAlias,
      token = { issuedAt: at("14:50:00"), expiresAt: at("15:20:00") },
    ) => {
      const sessionToken =
        "sessionToken" in token
          ? token.sessionToken
          : await mintToken(privateKey, {
              sub: external(principalAlias),
              authTime: token.issuedAt,
              iat: token.issuedAt,
              exp: token.expiresAt,
            });
      const response = (await fetchWorker(
        `/agents/case-agent/${encodeIdentifier("cse", seededUuid(caseAlias))}`,
        {
          headers: {
            Origin: ORIGIN,
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            Cookie: `__Host-session=${sessionToken}`,
          },
        },
      )) as unknown as RawUpgradeResponse;
      if (response.webSocket === undefined) throw new Error(`The upgrade was refused: ${response.status}`);
      return new AgentConversation(response.webSocket);
    },
    signingKey: privateKey,
    owner,
    close: async () => {
      await server.close();
      await owner.close();
      await database.drop();
    },
  };
}

import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import { generateKeyPair } from "../../../../external/jose.ts";
import { AUDIT_KEY, IDENTIFIER_KEY, ORIGIN } from "./harness.ts";

const ENTRY = fileURLToPath(new URL("../e2e/worker-under-test.ts", import.meta.url));

type TestServer = ReturnType<typeof createTestHarness>;
/** Miniflare's request options and response: a `101` response carries the accepted `webSocket`. */
type WorkerFetch = (
  path: string,
  init?: Parameters<TestServer["fetch"]>[1],
) => ReturnType<TestServer["fetch"]>;

export interface WorkerHarness {
  /** Dispatches a request to the Worker; its URL is the application's origin. */
  readonly fetch: WorkerFetch;
  readonly signingKey: CryptoKey;
  readonly owner: PostgresConnection;
  readonly close: () => Promise<void>;
}

/** The application running in the Workers runtime against a fresh database, at the specs' fixed instant. */
export async function createWorkerHarness(): Promise<WorkerHarness> {
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
          vars: {
            APPLICATION_ORIGIN: ORIGIN,
            SESSION_SIGNING_KEY: JSON.stringify(privateJwk),
            AUDIT_HASH_KEY: AUDIT_KEY,
            IDENTIFIER_HASH_KEY: IDENTIFIER_KEY,
          },
        },
      },
    ],
  });
  await server.listen();
  const owner = await PostgresConnection.open(database.connectionString);
  return {
    fetch: (path, init) => server.fetch(`${ORIGIN}${path}`, init),
    signingKey: privateKey,
    owner,
    close: async () => {
      await server.close();
      await owner.close();
      await database.drop();
    },
  };
}

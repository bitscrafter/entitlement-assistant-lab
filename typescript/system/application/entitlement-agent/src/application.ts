import { HmacIdentifierHasher } from "../../../adapter/identifier/hmac-identifier-hasher.ts";
import {
  APPLICATION_DATABASE_ROLE,
  type PostgresConnection,
} from "../../../adapter/postgres/postgres-connection.ts";
import { PostgresUnitOfWork } from "../../../adapter/postgres/postgres-unit-of-work.ts";
import { JoseSessionToken } from "../../../adapter/session-token/jose-session-token.ts";
import { z } from "../../../external/zod.ts";
import { decodeIdentifier, encodeIdentifier, type Uuid } from "../../../kernel/identifier.ts";
import type { Clock } from "../../../port/clock.ts";
import type { IdGenerator } from "../../../port/id-generator.ts";
import type { SecurityEventCause, SecurityEventLog } from "../../../port/security-event-log.ts";
import { PostgresRoleRepository } from "../../../subsystem/access/src/infra/postgres-role-repository.ts";
import { GetSessionPrincipal } from "../../../subsystem/access/src/usecase/get-session-principal.ts";
import { PostgresInternalAccountRepository } from "../../../subsystem/account/src/infra/postgres-internal-account-repository.ts";
import { LoadPrincipal } from "../../../subsystem/account/src/usecase/load-principal.ts";
import { RenewSession } from "../../../subsystem/account/src/usecase/renew-session.ts";
import { SignIn } from "../../../subsystem/account/src/usecase/sign-in.ts";
import { SignOut } from "../../../subsystem/account/src/usecase/sign-out.ts";
import { PostgresAuditRecorder } from "../../../subsystem/attribution/src/infra/postgres-audit-recorder.ts";
import { PostgresEmployeeRepository } from "../../../subsystem/internal-identity/src/infra/postgres-employee-repository.ts";
import { WebCryptoPasswordHasher } from "../../../subsystem/internal-identity/src/infra/web-crypto-password-hasher.ts";
import { GetEmployeeProfile } from "../../../subsystem/internal-identity/src/usecase/get-employee-profile.ts";
import { VerifyEmployeeCredential } from "../../../subsystem/internal-identity/src/usecase/verify-employee-credential.ts";
import { authenticatePrincipal, authenticateSession, originAllowed } from "./http/request-guard.ts";
import { errorResponse, jsonResponse, noContent } from "./http/responses.ts";
import { clearedSessionCookie, sessionCookie } from "./http/session-cookie.ts";
import { traceIdOf } from "./http/trace.ts";

/** Everything the application needs from its environment; the Worker builds it from bindings, tests build it directly. */
export interface ApplicationDependencies {
  readonly applicationOrigin: string;
  readonly openDatabase: () => Promise<PostgresConnection>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly securityEventLog: SecurityEventLog;
  readonly sessionSigningKey: {
    readonly keyId: string;
    readonly privateKey: CryptoKey;
    readonly publicKey: CryptoKey;
  };
  readonly auditHashKey: { readonly keyId: string; readonly key: CryptoKey };
  readonly identifierHashKey: CryptoKey;
}

export interface Application {
  fetch(request: Request): Promise<Response>;
}

const signInBody = z.strictObject({
  email: z.string().max(320),
  password: z.string().max(1024),
  account_id: z.string().optional(),
});

/** No request of this API needs more; a larger body is refused before any work (api.md §2). */
const MAXIMUM_BODY_BYTES = 16 * 1024;

interface RequestContext {
  readonly request: Request;
  /** The whole body, read before any database connection opens, so a slow client holds no transaction. */
  readonly body: string;
  readonly traceId: string;
  readonly useCases: UseCases;
  readonly reject: (cause: SecurityEventCause) => Response;
}

type Handler = (context: RequestContext) => Promise<Response>;

/** The composition root: wires adapters to use cases and routes requests to them (A1: no rule lives here). */
export function createApplication(dependencies: ApplicationDependencies): Application {
  const tokens = new JoseSessionToken(dependencies.sessionSigningKey);
  const passwordHasher = new WebCryptoPasswordHasher();
  const identifierHasher = new HmacIdentifierHasher(dependencies.identifierHashKey);

  const routes: Readonly<Record<string, Handler>> = {
    "POST /api/authentication/sign-in": signInHandler,
    "POST /api/authentication/session/renewal": renewalHandler,
    "GET /api/authentication/session": sessionHandler,
    "POST /api/authentication/sign-out": signOutHandler,
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const traceId = traceIdOf(request);
      const reject = (cause: SecurityEventCause): Response => {
        dependencies.securityEventLog.record({ cause, method: request.method, path: url.pathname, traceId });
        return errorResponse(cause === "ForeignOrigin" ? "forbidden" : "invalid_session");
      };
      if (!originAllowed(request, dependencies.applicationOrigin)) return reject("ForeignOrigin");
      const handler = routes[`${request.method} ${url.pathname}`];
      if (handler === undefined) return errorResponse("not_found");

      const body = request.method === "GET" ? "" : await request.text().catch(() => null);
      if (body === null || new TextEncoder().encode(body).length > MAXIMUM_BODY_BYTES) {
        return errorResponse("invalid_request");
      }

      let connection: PostgresConnection | undefined;
      try {
        connection = await dependencies.openDatabase();
        const useCases = buildUseCases(connection, dependencies, tokens, passwordHasher, identifierHasher);
        // One transaction per request: every statement acts with the application's role (CM-13).
        return await useCases.unitOfWork.run(() => handler({ request, body, traceId, useCases, reject }));
      } catch (error) {
        console.error(JSON.stringify({ log: "unexpected-error", traceId, message: String(error) }));
        return errorResponse("server_error", traceId);
      } finally {
        await connection?.close().catch(() => undefined);
      }
    },
  };

  async function signInHandler({ request, body, traceId, useCases }: RequestContext): Promise<Response> {
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      return errorResponse("invalid_request");
    }
    const parsed = signInBody.safeParse(parseJson(body));
    if (!parsed.success) return errorResponse("invalid_request");
    let declaredAccountId: Uuid | null = null;
    if (parsed.data.account_id !== undefined) {
      const decoded = decodeIdentifier("iac", parsed.data.account_id);
      if (!decoded.ok) return errorResponse("invalid_request");
      declaredAccountId = decoded.value;
    }
    const result = await useCases.signIn.execute({
      email: parsed.data.email,
      password: parsed.data.password,
      declaredAccountId,
      traceId,
    });
    if (!result.ok) return errorResponse("invalid_credentials");
    return noContent({ "set-cookie": sessionCookie(result.value.token, result.value.lifetimeSeconds) });
  }

  async function renewalHandler({ request, traceId, useCases, reject }: RequestContext): Promise<Response> {
    const session = await authenticateSession(request, tokens, dependencies.clock.now());
    if (!session.ok) return reject(session.failure);
    // The renewal re-checks the principal itself, so that a refused renewal is audited.
    const result = await useCases.renewSession.execute(session.value, traceId);
    if (!result.ok) {
      return errorResponse(
        result.failure === "AbsoluteLifetimeReached" ? "absolute_lifetime_reached" : "invalid_session",
      );
    }
    if (result.value.kind === "Unchanged") return noContent();
    return noContent({ "set-cookie": sessionCookie(result.value.token, result.value.lifetimeSeconds) });
  }

  async function sessionHandler({ request, useCases, reject }: RequestContext): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      request,
      tokens,
      useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return reject(authenticated.failure);
    const principal = await useCases.getSessionPrincipal.execute(authenticated.value.principal);
    return jsonResponse(200, {
      account_id: encodeIdentifier("iac", principal.accountId),
      display_name: principal.accountDisplayName,
      department: principal.departmentKey,
      job_function: principal.jobFunctionKey,
      job_level: principal.jobLevel,
      roles: principal.roles,
    });
  }

  async function signOutHandler({ request, traceId, useCases, reject }: RequestContext): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      request,
      tokens,
      useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return reject(authenticated.failure);
    await useCases.signOut.execute(authenticated.value.claims, traceId);
    return noContent({ "set-cookie": clearedSessionCookie() });
  }
}

interface UseCases {
  readonly unitOfWork: PostgresUnitOfWork;
  readonly loadPrincipal: LoadPrincipal;
  readonly signIn: SignIn;
  readonly renewSession: RenewSession;
  readonly getSessionPrincipal: GetSessionPrincipal;
  readonly signOut: SignOut;
}

function buildUseCases(
  connection: PostgresConnection,
  dependencies: ApplicationDependencies,
  tokens: JoseSessionToken,
  passwordHasher: WebCryptoPasswordHasher,
  identifierHasher: HmacIdentifierHasher,
): UseCases {
  const { clock, idGenerator: ids } = dependencies;
  const unitOfWork = new PostgresUnitOfWork(connection, { role: APPLICATION_DATABASE_ROLE });
  const audit = new PostgresAuditRecorder({
    connection,
    unitOfWork,
    idGenerator: ids,
    clock,
    hashKey: dependencies.auditHashKey,
  });
  const employees = new PostgresEmployeeRepository(connection);
  const accounts = new PostgresInternalAccountRepository(connection);
  const loadPrincipal = new LoadPrincipal({
    accounts,
    getEmployeeProfile: new GetEmployeeProfile({ employees }),
  });
  return {
    unitOfWork,
    loadPrincipal,
    signIn: new SignIn({
      verifyEmployeeCredential: new VerifyEmployeeCredential({ employees, hasher: passwordHasher }),
      loadPrincipal,
      accounts,
      tokens,
      audit,
      identifierHasher,
      unitOfWork,
      clock,
      ids,
    }),
    renewSession: new RenewSession({ loadPrincipal, tokens, audit, unitOfWork, clock, ids }),
    getSessionPrincipal: new GetSessionPrincipal({
      roles: new PostgresRoleRepository(connection),
      clock,
    }),
    signOut: new SignOut({ audit, unitOfWork }),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

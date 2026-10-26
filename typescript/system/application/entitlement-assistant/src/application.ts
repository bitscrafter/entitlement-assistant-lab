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
import type { LanguageModel } from "../../../port/language-model.ts";
import type { MessageRateLimiter } from "../../../port/message-rate-limiter.ts";
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
import type { PolicySet } from "../../../subsystem/policy/src/model/policy.ts";
import { PolicySetActivationCheck } from "../../../subsystem/policy/src/usecase/evaluate-policies.ts";
import { PostgresCaseRepository } from "../../../subsystem/support/src/infra/postgres-case-repository.ts";
import { CheckEntitlement } from "../../../subsystem/support/src/usecase/check-entitlement.ts";
import { ExplainAccess } from "../../../subsystem/support/src/usecase/explain-access.ts";
import { FindCustomerAccount } from "../../../subsystem/support/src/usecase/find-customer-account.ts";
import { ListEntitlements } from "../../../subsystem/support/src/usecase/list-entitlements.ts";
import { OpenCase } from "../../../subsystem/support/src/usecase/open-case.ts";
import { ReadEnforcement } from "../../../subsystem/support/src/usecase/read-enforcement.ts";
import { CaseAgent, type ConnectionSession } from "./agent/case-agent.ts";
import { type CaseWork, composeCaseWork } from "./compose-case-work.ts";
import {
  authenticatePrincipal,
  authenticateSession,
  isWebSocketUpgrade,
  originAllowed,
} from "./http/request-guard.ts";
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
  /** The policy set bundled into the Worker (policy §6). */
  readonly policySet: PolicySet;
  /** Hands an accepted WebSocket upgrade to the case's agent (a Durable Object in the Worker). */
  readonly forwardToCaseAgent: (
    request: Request,
    caseId: Uuid,
    session: ConnectionSession,
  ) => Promise<Response>;
}

/** The use cases a case agent's tools and the verification tests call (api.md §10). */
export interface CaseWorkUseCases {
  readonly openCase: OpenCase;
  readonly findCustomerAccount: FindCustomerAccount;
  readonly checkEntitlement: CheckEntitlement;
  readonly listEntitlements: ListEntitlements;
  readonly explainAccess: ExplainAccess;
}

export interface Application {
  fetch(request: Request): Promise<Response>;
  /**
   * Runs `work` with the use cases on one database connection, in one transaction.
   *
   * @ensures What `work` writes commits together, or not at all when it rejects.
   */
  withUseCases<Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>): Promise<Value>;
  /** The case agent of one case, with the adapters only its runtime can supply. */
  createCaseAgent(
    caseId: Uuid,
    adapters: { readonly languageModel: LanguageModel; readonly rateLimiter: MessageRateLimiter },
  ): CaseAgent;
}

const signInBody = z.strictObject({
  email: z.string().max(320),
  password: z.string().max(1024),
  account_id: z.string().optional(),
});

/** Every case agent's WebSocket lives under this path, followed by the case id (api.md §8). */
const CASE_AGENT_PATH = "/agents/case-agent/";

/** Opening a case takes no parameters: the body is exactly an empty object. */
const emptyBody = z.strictObject({});

/** The fixed error each rejection answers (api.md §3): an unknown case and another's case look the same (D1). */
function errorCodeOf(cause: SecurityEventCause): "forbidden" | "not_found" | "invalid_session" {
  switch (cause) {
    case "ForeignOrigin":
      return "forbidden";
    case "CaseNotFound":
    case "CaseNotAssigned":
      return "not_found";
    case "NoSession":
    case "MalformedToken":
    case "InvalidSignature":
    case "UnsupportedAlgorithm":
    case "WrongIssuer":
    case "WrongAudience":
    case "Expired":
    case "PrincipalInactive":
      return "invalid_session";
  }
}

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
  const policySetActivation = new PolicySetActivationCheck();

  const routes: Readonly<Record<string, Handler>> = {
    "POST /api/authentication/sign-in": signInHandler,
    "POST /api/authentication/session/renewal": renewalHandler,
    "GET /api/authentication/session": sessionHandler,
    "POST /api/authentication/sign-out": signOutHandler,
    "POST /api/cases": openCaseHandler,
  };

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const traceId = traceIdOf(request);
      const reject = (cause: SecurityEventCause): Response => {
        dependencies.securityEventLog.record({ cause, method: request.method, path: url.pathname, traceId });
        return errorResponse(errorCodeOf(cause));
      };
      if (!originAllowed(request, dependencies.applicationOrigin)) return reject("ForeignOrigin");
      const handler =
        routes[`${request.method} ${url.pathname}`] ??
        (request.method === "GET" && url.pathname.startsWith(CASE_AGENT_PATH) ? caseAgentHandler : undefined);
      if (handler === undefined) return errorResponse("not_found");

      const body = request.method === "GET" ? "" : await request.text().catch(() => null);
      if (body === null || new TextEncoder().encode(body).length > MAXIMUM_BODY_BYTES) {
        return errorResponse("invalid_request");
      }

      let connection: PostgresConnection | undefined;
      try {
        connection = await dependencies.openDatabase();
        const useCases = buildUseCases(
          connection,
          dependencies,
          tokens,
          passwordHasher,
          identifierHasher,
          policySetActivation,
        );
        // One transaction per request: every statement acts with the application's role (CM-13).
        return await useCases.unitOfWork.run(() => handler({ request, body, traceId, useCases, reject }));
      } catch (error) {
        console.error(JSON.stringify({ log: "unexpected-error", traceId, message: String(error) }));
        return errorResponse("server_error", traceId);
      } finally {
        await connection?.close().catch(() => undefined);
      }
    },

    async withUseCases<Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>): Promise<Value> {
      const connection = await dependencies.openDatabase();
      try {
        const useCases = buildUseCases(
          connection,
          dependencies,
          tokens,
          passwordHasher,
          identifierHasher,
          policySetActivation,
        );
        return await useCases.unitOfWork.run(() => work(useCases));
      } finally {
        await connection.close().catch(() => undefined);
      }
    },

    createCaseAgent(): CaseAgent {
      return new CaseAgent();
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

  async function openCaseHandler({
    request,
    body,
    traceId,
    useCases,
    reject,
  }: RequestContext): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      request,
      tokens,
      useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return reject(authenticated.failure);
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
      return errorResponse("invalid_request");
    if (!emptyBody.safeParse(parseJson(body)).success) return errorResponse("invalid_request");
    const result = await useCases.openCase.execute({
      principalAccountId: authenticated.value.principal.accountId,
      sessionId: authenticated.value.claims.sessionId,
      traceId,
    });
    if (result.kind === "Forbidden") return errorResponse("forbidden");
    return jsonResponse(201, { case_id: encodeIdentifier("cse", result.caseId) });
  }

  /** The WebSocket upgrade to a case agent (api.md §8): only the case's current assignee connects (D1). */
  async function caseAgentHandler({ request, useCases, reject }: RequestContext): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return errorResponse("not_found");
    const authenticated = await authenticatePrincipal(
      request,
      tokens,
      useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return reject(authenticated.failure);
    const caseId = decodeIdentifier("cse", new URL(request.url).pathname.slice(CASE_AGENT_PATH.length));
    if (!caseId.ok) return reject("CaseNotFound");
    const assignment = await useCases.cases.currentAssignee(caseId.value);
    if (!assignment.exists) return reject("CaseNotFound");
    if (assignment.assigneeAccountId !== authenticated.value.principal.accountId)
      return reject("CaseNotAssigned");
    return dependencies.forwardToCaseAgent(request, caseId.value, {
      principalAccountId: authenticated.value.principal.accountId,
      sessionId: authenticated.value.claims.sessionId,
      expiresAt: authenticated.value.claims.expiresAt,
    });
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

interface UseCases extends CaseWorkUseCases {
  readonly unitOfWork: PostgresUnitOfWork;
  readonly caseWork: CaseWork;
  readonly cases: PostgresCaseRepository;
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
  policySetActivation: PolicySetActivationCheck,
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
  const caseWork = composeCaseWork(connection, {
    clock,
    loadPrincipal,
    policySet: dependencies.policySet,
    policySetActivation,
  });
  const enforcement = new ReadEnforcement({
    decider: caseWork.decider,
    audit,
    getCustomerAccount: caseWork.getCustomerAccount,
  });
  const cases = new PostgresCaseRepository(connection);
  return {
    unitOfWork,
    loadPrincipal,
    caseWork,
    cases,
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
    openCase: new OpenCase({ decider: caseWork.decider, audit, cases, ids, clock }),
    findCustomerAccount: new FindCustomerAccount({
      enforcement,
      identifierHasher,
      findIndividualByEmail: caseWork.findIndividualByEmail,
      getIndividuals: caseWork.getIndividuals,
      getCustomerAccount: caseWork.getCustomerAccount,
      listAccountRoles: caseWork.listAccountRoles,
      computeEffectiveEntitlements: caseWork.computeEffectiveEntitlements,
      clock,
    }),
    checkEntitlement: new CheckEntitlement({
      enforcement,
      computeEffectiveEntitlements: caseWork.computeEffectiveEntitlements,
      clock,
    }),
    listEntitlements: new ListEntitlements({
      enforcement,
      computeEffectiveEntitlements: caseWork.computeEffectiveEntitlements,
      clock,
    }),
    explainAccess: new ExplainAccess({
      enforcement,
      decider: caseWork.decider,
      findIndividualByEmail: caseWork.findIndividualByEmail,
      getCustomerAccount: caseWork.getCustomerAccount,
      computeEffectiveEntitlements: caseWork.computeEffectiveEntitlements,
      findLowestPlanIncluding: caseWork.findLowestPlanIncluding,
      clock,
    }),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

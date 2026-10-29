import { HmacIdentifierHasher } from "../../../adapter/identifier/hmac-identifier-hasher.ts";
import {
  APPLICATION_DATABASE_ROLE,
  type PostgresConnection,
} from "../../../adapter/postgres/postgres-connection.ts";
import { PostgresTransactionalOutbox } from "../../../adapter/postgres/postgres-transactional-outbox.ts";
import { PostgresUnitOfWork } from "../../../adapter/postgres/postgres-unit-of-work.ts";
import { JoseSessionToken } from "../../../adapter/session-token/jose-session-token.ts";
import type { Tool } from "../../../external/ai.ts";
import { z } from "../../../external/zod.ts";
import { decodeIdentifier, encodeIdentifier, type Uuid } from "../../../kernel/identifier.ts";
import type { UsageCaps } from "../../../kernel/usage-caps.ts";
import type { Clock } from "../../../port/clock.ts";
import type { DailyAllowance } from "../../../port/daily-allowance.ts";
import type { IdGenerator } from "../../../port/id-generator.ts";
import type { MessageRateLimiter } from "../../../port/message-rate-limiter.ts";
import type { SecurityEventCause, SecurityEventLog } from "../../../port/security-event-log.ts";
import { PostgresRoleRepository } from "../../../subsystem/access/src/infra/postgres-role-repository.ts";
import { GetSessionPrincipal } from "../../../subsystem/access/src/usecase/get-session-principal.ts";
import { PostgresInternalAccountRepository } from "../../../subsystem/account/src/infra/postgres-internal-account-repository.ts";
import { GetInternalAccountNames } from "../../../subsystem/account/src/usecase/get-internal-account-names.ts";
import { LoadPrincipal } from "../../../subsystem/account/src/usecase/load-principal.ts";
import { RenewSession } from "../../../subsystem/account/src/usecase/renew-session.ts";
import { SignIn } from "../../../subsystem/account/src/usecase/sign-in.ts";
import { SignOut } from "../../../subsystem/account/src/usecase/sign-out.ts";
import { PostgresAuditRecorder } from "../../../subsystem/attribution/src/infra/postgres-audit-recorder.ts";
import { PostgresCaseRecordRepository } from "../../../subsystem/attribution/src/infra/postgres-case-record-repository.ts";
import { ListCaseRecords } from "../../../subsystem/attribution/src/usecase/list-case-records.ts";
import { PostgresGrantRepository } from "../../../subsystem/entitlement/src/infra/postgres-grant-repository.ts";
import { EntitlementDiffs } from "../../../subsystem/entitlement/src/usecase/entitlement-diffs.ts";
import {
  ChangeGrants,
  GetGrant,
  RecordGrantExpiries,
} from "../../../subsystem/entitlement/src/usecase/grant-changes.ts";
import { PostgresEmployeeRepository } from "../../../subsystem/internal-identity/src/infra/postgres-employee-repository.ts";
import { WebCryptoPasswordHasher } from "../../../subsystem/internal-identity/src/infra/web-crypto-password-hasher.ts";
import { GetEmployeeProfile } from "../../../subsystem/internal-identity/src/usecase/get-employee-profile.ts";
import { VerifyEmployeeCredential } from "../../../subsystem/internal-identity/src/usecase/verify-employee-credential.ts";
import type { PolicySet } from "../../../subsystem/policy/src/model/policy.ts";
import { PolicySetActivationCheck } from "../../../subsystem/policy/src/usecase/evaluate-policies.ts";
import { PostgresCaseRepository } from "../../../subsystem/support/src/infra/postgres-case-repository.ts";
import { PostgresChangeRequestRepository } from "../../../subsystem/support/src/infra/postgres-change-request-repository.ts";
import { SUMMARY_WITH_EMAIL } from "../../../subsystem/support/src/model/case-summary.ts";
import type { DenialReason } from "../../../subsystem/support/src/model/change-request.ts";
import { ApplyChangeRequest } from "../../../subsystem/support/src/usecase/apply-change-request.ts";
import {
  ApplyApprovedChange,
  ExpireApproval,
} from "../../../subsystem/support/src/usecase/approval-process-steps.ts";
import { AuthenticateContact } from "../../../subsystem/support/src/usecase/authenticate-contact.ts";
import { CancelChangeRequest } from "../../../subsystem/support/src/usecase/cancel-change-request.ts";
import {
  type ActionRefusal,
  CaseActionEnforcement,
  CaseAssigneeCheck,
  type CaseRefusal,
} from "../../../subsystem/support/src/usecase/case-action-enforcement.ts";
import { CheckEntitlement } from "../../../subsystem/support/src/usecase/check-entitlement.ts";
import { CloseCase } from "../../../subsystem/support/src/usecase/close-case.ts";
import {
  APPROVAL_PROCESS_DESTINATION,
  ConfirmChangeRequest,
} from "../../../subsystem/support/src/usecase/confirm-change-request.ts";
import {
  DecideApproval,
  ListPendingApprovals,
} from "../../../subsystem/support/src/usecase/decide-approval.ts";
import { ExplainAccess } from "../../../subsystem/support/src/usecase/explain-access.ts";
import {
  FindCustomerAccount,
  MINIMUM_QUERY_LENGTH,
} from "../../../subsystem/support/src/usecase/find-customer-account.ts";
import { type CaseView, GetCase } from "../../../subsystem/support/src/usecase/get-case.ts";
import { GetChangeRequest } from "../../../subsystem/support/src/usecase/get-change-request.ts";
import { type CaseEvent, ListCaseEvents } from "../../../subsystem/support/src/usecase/list-case-events.ts";
import { ListClosedCases } from "../../../subsystem/support/src/usecase/list-closed-cases.ts";
import { ListEntitlements } from "../../../subsystem/support/src/usecase/list-entitlements.ts";
import { OpenCase } from "../../../subsystem/support/src/usecase/open-case.ts";
import { PrepareChangeRequest } from "../../../subsystem/support/src/usecase/prepare-change-request.ts";
import { ProposeCaseSubject } from "../../../subsystem/support/src/usecase/propose-case-subject.ts";
import { ReadEnforcement } from "../../../subsystem/support/src/usecase/read-enforcement.ts";
import { SetCaseContact } from "../../../subsystem/support/src/usecase/set-case-contact.ts";
import { SetCaseSubject } from "../../../subsystem/support/src/usecase/set-case-subject.ts";
import { agentTools } from "./agent/agent-tools.ts";
import { caseStateLine } from "./agent/case-state.ts";
import { REASON_DESCRIPTIONS } from "./agent/reason-descriptions.ts";
import { lookupOutputOf } from "./agent/tools.ts";
import { type ConnectionSession, WebSocketMessageGuard } from "./agent/websocket-message-guard.ts";
import type { ApprovalProcess } from "./approval-process.ts";
import type { CaseEventsDelivery } from "./case-events-delivery.ts";
import type { CaseWebSocketConnections } from "./case-websocket-connections.ts";
import type { CaseWorkUseCases } from "./case-work-use-cases.ts";
import { diffBody, parametersBody, reasonsBody } from "./change-request-body.ts";
import { type CaseWork, composeCaseWork } from "./compose-case-work.ts";
import {
  authenticatePrincipal,
  authenticateSession,
  isWebSocketUpgrade,
  originAllowed,
} from "./http/request-guard.ts";
import { detailedErrorResponse, errorResponse, jsonResponse, noContent } from "./http/responses.ts";
import { clearedSessionCookie, sessionCookie } from "./http/session-cookie.ts";
import { traceIdOf } from "./http/trace.ts";
import { deliverApprovalMessage } from "./outbox-relay.ts";

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
  /** Closes a case agent's WebSocket connections when the case closes (case-lifecycle D7). */
  readonly caseWebSocketConnections: CaseWebSocketConnections;
  /** Bounds the case panel's account search per employee, as chat messages are (case-lifecycle D18; review R3-1). */
  readonly searchRateLimiter: MessageRateLimiter;
  /** Hands a case's new events to its agent after an action commits (case-lifecycle D21). */
  readonly caseEventsDelivery: CaseEventsDelivery;
  /** The demo's daily allowances (usage-guards D2, D3): global model calls, and each employee's messages. */
  readonly dailyAllowance: DailyAllowance;
  /** The caps derived from the daily AI neuron budget (usage-guards D1). */
  readonly usageCaps: UsageCaps;
  /** Sign-in attempts per IP address per minute (usage-guards D6). */
  readonly signInRateLimiter: MessageRateLimiter;
  /** Starts, wakes, and stops the approval process of each approval (grants-and-approvals D6). */
  readonly approvalProcess: ApprovalProcess;
  /** How long an approval waits for a decision (D9: 72 hours). */
  readonly approvalWindowMilliseconds: number;
  /** How old an undelivered outbox message is before the sweep delivers it (D6: `OUTBOX_RETRY_AFTER_SECONDS`). */
  readonly outboxRetryAfterMilliseconds: number;
}

export type { CaseWorkUseCases };

export interface Application {
  fetch(request: Request): Promise<Response>;
  /**
   * Runs `work` with the use cases on one database connection, in one transaction.
   *
   * @ensures What `work` writes commits together, or not at all when it rejects.
   */
  withUseCases<Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>): Promise<Value>;
  /** What the case agent of one case needs from the application, with the adapter only its runtime supplies. */
  caseAgentParts(caseId: Uuid, adapters: { readonly rateLimiter: MessageRateLimiter }): CaseAgentParts;
  /**
   * The scheduled sweep (grants-and-approvals D6, D10): records expired grants, expires approvals whose deadline
   * passed without their process, and delivers outbox messages still undelivered after the retry delay.
   */
  sweep(): Promise<void>;
  /** The approval process woke for its approval: the decision arrived, or the deadline (D8, D9). */
  approvalProcessWoke(approvalId: Uuid, cause: "decision" | "deadline"): Promise<void>;
  /**
   * Every route the application answers, as `METHOD /path` with `{…}` for path parameters: the architecture test of
   * `llm-never-authorizes` covers each one, so a new route cannot skip it.
   */
  routeKeys(): readonly string[];
}

export interface CaseAgentParts {
  /** Decides every WebSocket message before the Agents SDK sees it. */
  readonly messageGuard: WebSocketMessageGuard;
  /** The tools of a chat turn, acting for the connection's principal. */
  readonly tools: (actor: {
    readonly principalAccountId: Uuid;
    readonly sessionId: Uuid;
  }) => Record<string, Tool>;
  readonly clock: Clock;
  readonly newTraceId: () => string;
  /**
   * Takes one model call from the demo's day (usage-guards D2), before the call is made: `Refused` when none is left
   * or the assistant is off (D5).
   */
  readonly takeModelCall: () => Promise<"Allowed" | "Refused">;
  /** The case's events, derived from its audit records (case-lifecycle D21). */
  readonly caseEvents: () => Promise<readonly CaseEvent[]>;
  /** A turn's events (D21) and the case state line (D22), as the actor may read the case, in one transaction. */
  readonly turnContext: (actor: {
    readonly principalAccountId: Uuid;
    readonly sessionId: Uuid;
  }) => Promise<{ readonly events: readonly CaseEvent[]; readonly state: string }>;
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
  /** Runs `task` once the request's transaction has committed (never when it rolls back). */
  readonly afterCommit: (task: () => Promise<void>) => void;
}

type Handler = (context: RequestContext) => Promise<Response>;
type CaseHandler = (context: RequestContext, caseId: string) => Promise<Response>;

const accountBody = z.strictObject({ account_id: z.string().max(64) });
const authenticationBody = z.strictObject({
  kind: z.string().max(32),
  method: z.string().max(32),
  passed: z.boolean(),
});
const closureBody = z.strictObject({
  close_reason: z.enum(["Resolved", "Abandoned"]),
  summary: z.string().trim().min(1).max(4000),
});
const DENIAL_REASONS = ["PolicyLimit", "InsufficientJustification", "CustomerNotEligible", "Other"] as const;
const decisionBody = z.strictObject({
  decision: z.enum(["Approved", "Denied"]),
  decision_reason: z.enum(DENIAL_REASONS).optional(),
  decision_comment: z.string().trim().min(1).max(1000).optional(),
});

/** How many outbox messages one sweep delivers at most; the next sweep delivers the rest. */
const OUTBOX_MESSAGES_PER_SWEEP = 100;

/** How many approvals past their deadline one sweep expires at most. */
const OVERDUE_APPROVALS_PER_SWEEP = 100;

/** How a malformed field reads to an authenticated caller (api.md §3). */
const FIELD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  account_id: "Must be an account id.",
  kind: "Must be an authentication kind.",
  method: "Must be an authentication method.",
  passed: "Must be true or false.",
  close_reason: "Must be Resolved or Abandoned.",
  summary: "Must be 1 to 4,000 characters.",
  decision: "Must be Approved or Denied.",
  decision_reason: "A denial needs PolicyLimit, InsufficientJustification, CustomerNotEligible, or Other.",
  decision_comment: "Other needs a comment of 1 to 1,000 characters.",
};

/** A 400 naming the first offending field of a body that failed its schema. */
function invalidField(error: z.ZodError): Response {
  const field = String(error.issues[0]?.path[0] ?? "body");
  return detailedErrorResponse("invalid_request", [
    { error: field, error_description: FIELD_DESCRIPTIONS[field] ?? "The field is not allowed." },
  ]);
}

/** The case as the browser receives it (api.md §5, case-lifecycle D15). */
function caseBody(view: CaseView): unknown {
  const account = (id: Uuid) => encodeIdentifier("acc", id);
  const authentication = view.contactAuthentication;
  return {
    case_id: encodeIdentifier("cse", view.caseId),
    subject:
      view.subject === null
        ? null
        : view.subject.readable
          ? {
              account_id: account(view.subject.accountId),
              readable: true,
              display_name: view.subject.displayName,
              holds: view.subject.holds,
            }
          : { account_id: account(view.subject.accountId), readable: false },
    contact:
      view.contact === null
        ? null
        : view.contact.readable
          ? {
              account_id: account(view.contact.accountId),
              readable: true,
              display_name: view.contact.displayName,
              holds: view.contact.holds,
              roles_in_subject: view.contact.rolesInSubject,
            }
          : { account_id: account(view.contact.accountId), readable: false },
    contact_authentication:
      authentication === null
        ? null
        : {
            kind: authentication.kind,
            method: authentication.method,
            authenticated_by: encodeIdentifier("iac", authentication.authenticatedBy),
            authenticated_at: authentication.authenticatedAt.toISOString(),
            expires_at: authentication.expiresAt.toISOString(),
          },
    opened_at: view.openedAt.toISOString(),
    closed_at: view.closedAt?.toISOString() ?? null,
    close_reason: view.closeReason,
    summary: view.summary,
  };
}

/** The composition root: wires adapters to use cases and routes requests to them (A1: no rule lives here). */
export function createApplication(dependencies: ApplicationDependencies): Application {
  const tokens = new JoseSessionToken(dependencies.sessionSigningKey);
  const passwordHasher = new WebCryptoPasswordHasher();
  const identifierHasher = new HmacIdentifierHasher(dependencies.identifierHashKey);
  const policySetActivation = new PolicySetActivationCheck();

  /** One database connection and one transaction around `work`, the way every request runs. */
  async function withAllUseCases<Value>(work: (useCases: UseCases) => Promise<Value>): Promise<Value> {
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
  }

  const routes: Readonly<Record<string, Handler>> = {
    "POST /api/authentication/sign-in": signInHandler,
    "POST /api/authentication/session/renewal": renewalHandler,
    "GET /api/authentication/session": sessionHandler,
    "POST /api/authentication/sign-out": signOutHandler,
    "POST /api/cases": openCaseHandler,
    "GET /api/cases": closedCasesHandler,
    "GET /api/accounts": accountSearchHandler,
    "GET /api/approvals": approvalsHandler,
  };

  /** The handlers under `/api/cases/{case_id}` (api.md §5), by method and action. */
  const caseRoutes: Readonly<Record<string, CaseHandler>> = {
    "GET ": getCaseHandler,
    "PUT subject": setSubjectHandler,
    "PUT contact": setContactHandler,
    "POST contact-authentication": authenticateContactHandler,
    "POST closure": closeCaseHandler,
  };

  /** The change request routes of a case (api.md §6), by method and action. */
  const changeRequestRoutes: Readonly<
    Record<string, (context: RequestContext, caseId: string, changeRequestId: string) => Promise<Response>>
  > = {
    "GET ": getChangeRequestHandler,
    "POST confirmation": confirmChangeRequestHandler,
    "POST cancellation": cancelChangeRequestHandler,
  };

  /** A change request or approval route's handler; undefined when the path is not one. */
  function changeRouteOf(method: string, pathname: string): Handler | undefined {
    const change = /^\/api\/cases\/([^/]+)\/change-requests\/([^/]+)(?:\/([a-z-]+))?$/.exec(pathname);
    if (change !== null) {
      const handler = changeRequestRoutes[`${method} ${change[3] ?? ""}`];
      return handler === undefined
        ? undefined
        : (context) => handler(context, change[1] ?? "", change[2] ?? "");
    }
    const decision = /^\/api\/approvals\/([^/]+)\/decision$/.exec(pathname);
    if (decision !== null && method === "POST")
      return (context) => decideApprovalHandler(context, decision[1] ?? "");
    return undefined;
  }

  /** A case route's handler, with the case id it names; undefined when the path is not one. */
  function caseRouteOf(method: string, pathname: string): Handler | undefined {
    const match = /^\/api\/cases\/([^/]+)(?:\/([a-z-]+))?$/.exec(pathname);
    if (match === null) return undefined;
    const handler = caseRoutes[`${method} ${match[2] ?? ""}`];
    const caseId = match[1] ?? "";
    return handler === undefined ? undefined : (context) => handler(context, caseId);
  }

  /** How each reason code reads to a CSR: the policy's own description, then the register's. */
  const policyDescriptions = new Map(
    dependencies.policySet.policies.map((policy) => [`policy.${policy.policyKey}`, policy.description]),
  );
  const describeReason = (reasonCode: string): string =>
    policyDescriptions.get(reasonCode) ?? REASON_DESCRIPTIONS[reasonCode] ?? reasonCode;

  const newTraceId = () => traceIdOf(new Request(dependencies.applicationOrigin));
  /** A refusal by a usage guard, for the operators: which cap, never who or what (usage-guards). */
  const logUsageRefusal = (cap: string, traceId: string) =>
    console.warn(JSON.stringify({ log: "usage-cap-reached", cap, traceId }));
  const logFailure = (log: string, error: unknown) =>
    console.error(JSON.stringify({ log, message: String(error) }));

  /**
   * Delivers approval-process messages (D6): the given ones right after their transaction commits, or every one
   * still undelivered after the retry delay. Each delivery is marked in a transaction of its own, after the
   * destination took it; a failed one is counted and left for the next sweep.
   */
  async function relay(messageIds: readonly Uuid[] | "Due"): Promise<void> {
    const messages = await withAllUseCases((useCases) =>
      messageIds === "Due"
        ? useCases.outbox.undelivered(
            APPROVAL_PROCESS_DESTINATION,
            new Date(dependencies.clock.now().getTime() - dependencies.outboxRetryAfterMilliseconds),
            OUTBOX_MESSAGES_PER_SWEEP,
          )
        : useCases.outbox.undeliveredByIds(APPROVAL_PROCESS_DESTINATION, messageIds),
    );
    for (const message of messages) {
      try {
        await deliverApprovalMessage(dependencies.approvalProcess, message);
        await withAllUseCases((useCases) =>
          useCases.outbox.markDelivered(message.messageId, dependencies.clock.now()),
        );
      } catch (error) {
        logFailure("outbox-delivery-failed", error);
        await withAllUseCases((useCases) =>
          useCases.outbox.markAttemptFailed(message.messageId, String(error)),
        ).catch((markError: unknown) => logFailure("outbox-mark-failed", markError));
      }
    }
  }

  /** The approval process's wake (D8, D9): the use case runs as `sys_approval_process`; the case hears the outcome. */
  async function approvalProcessWoke(approvalId: Uuid, cause: "decision" | "deadline"): Promise<void> {
    const outcome = await withAllUseCases(async (useCases) => {
      const systemAccountId = await useCases.loadPrincipal.systemAccountIdNamed("approval-process");
      if (systemAccountId === null) throw new Error("The approval-process system identity is missing.");
      const actor = { systemAccountId, traceId: newTraceId(), approvalId };
      if (cause === "decision") return useCases.applyApprovedChange.execute(actor);
      // A decision that arrived after the timer fired was approved in time: it is applied, never lost (review R1-1).
      const expired = await useCases.expireApproval.execute(actor);
      return expired.kind === "NothingToDo" ? useCases.applyApprovedChange.execute(actor) : expired;
    });
    if (outcome.kind !== "NothingToDo")
      await dependencies.caseEventsDelivery
        .deliver(outcome.caseId)
        .catch((error: unknown) => logFailure("case-events-delivery-failed", error));
  }

  return {
    async sweep(): Promise<void> {
      const now = dependencies.clock.now();
      // Each stage runs whatever the others do: one failure never stops the outbox's delivery (review R1-6).
      const stage = (name: string, work: () => Promise<void>) =>
        work().catch((error: unknown) => logFailure(`sweep-${name}-failed`, error));
      await stage("grant-expiries", () =>
        withAllUseCases(async (useCases) => {
          const systemAccountId = await useCases.loadPrincipal.systemAccountIdNamed("grant-expiry");
          if (systemAccountId === null) throw new Error("The grant-expiry system identity is missing.");
          await useCases.recordGrantExpiries.execute({ systemAccountId, at: now, traceId: newTraceId() });
        }),
      );
      await stage("approvals", async () => {
        // Pending past the deadline (a lost process), or approved and not applied (a lost decision): each wakes.
        const { overdue, approved } = await withAllUseCases(async (useCases) => ({
          overdue: await useCases.changeRequests.overdueApprovals(now, OVERDUE_APPROVALS_PER_SWEEP),
          approved: await useCases.changeRequests.approvedNotApplied(
            new Date(now.getTime() - dependencies.outboxRetryAfterMilliseconds),
            OVERDUE_APPROVALS_PER_SWEEP,
          ),
        }));
        for (const approval of overdue)
          await stage("approval", () => approvalProcessWoke(approval.approvalId, "deadline"));
        for (const approval of approved)
          await stage("approval", () => approvalProcessWoke(approval.approvalId, "decision"));
      });
      await stage("outbox", () => relay("Due"));
    },

    approvalProcessWoke,

    routeKeys(): readonly string[] {
      const under = (prefix: string, key: string) => {
        const [method = "", action = ""] = key.split(" ");
        return `${method} ${prefix}${action === "" ? "" : `/${action}`}`;
      };
      return [
        ...Object.keys(routes),
        ...Object.keys(caseRoutes).map((key) => under("/api/cases/{case_id}", key)),
        ...Object.keys(changeRequestRoutes).map((key) =>
          under("/api/cases/{case_id}/change-requests/{change_request_id}", key),
        ),
        "POST /api/approvals/{approval_id}/decision",
        `GET ${CASE_AGENT_PATH}{case_id}`,
      ].sort();
    },

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
        caseRouteOf(request.method, url.pathname) ??
        changeRouteOf(request.method, url.pathname) ??
        (request.method === "GET" && url.pathname.startsWith(CASE_AGENT_PATH) ? caseAgentHandler : undefined);
      if (handler === undefined) return errorResponse("not_found");

      const body = request.method === "GET" ? "" : await request.text().catch(() => null);
      if (body === null || new TextEncoder().encode(body).length > MAXIMUM_BODY_BYTES) {
        return errorResponse("invalid_request");
      }

      let connection: PostgresConnection | undefined;
      const committedTasks: (() => Promise<void>)[] = [];
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
        const response = await useCases.unitOfWork.run(() =>
          handler({
            request,
            body,
            traceId,
            useCases,
            reject,
            afterCommit: (task) => void committedTasks.push(task),
          }),
        );
        for (const task of committedTasks) {
          await task().catch((error: unknown) =>
            console.error(JSON.stringify({ log: "after-commit-failed", traceId, message: String(error) })),
          );
        }
        return response;
      } catch (error) {
        console.error(JSON.stringify({ log: "unexpected-error", traceId, message: String(error) }));
        return errorResponse("server_error", traceId);
      } finally {
        await connection?.close().catch(() => undefined);
      }
    },

    withUseCases<Value>(work: (useCases: CaseWorkUseCases) => Promise<Value>): Promise<Value> {
      return withAllUseCases(work);
    },

    caseAgentParts(caseId, adapters): CaseAgentParts {
      /** The case state line of D22, as the actor may read the case now. */
      const caseStateIn = async (
        useCases: UseCases,
        actor: { readonly principalAccountId: Uuid; readonly sessionId: Uuid },
      ): Promise<string> => {
        const view = await useCases.getCase.execute({
          principalAccountId: actor.principalAccountId,
          sessionId: actor.sessionId,
          traceId: newTraceId(),
          caseId,
        });
        if ("kind" in view) return "The case is no longer yours.";
        let email: string | null = null;
        if (view.contact?.readable === true) {
          const account = await useCases.caseWork.getCustomerAccount.execute(view.contact.accountId);
          if (account !== null)
            email = (await useCases.caseWork.getIndividuals.execute([account.customerId]))[0]?.email ?? null;
        }
        return caseStateLine(view, email, dependencies.clock.now());
      };
      const caseAssignedTo = async (accountId: Uuid) =>
        (await withAllUseCases((useCases) => useCases.cases.currentAssignee(caseId))).assigneeAccountId ===
        accountId;
      return {
        clock: dependencies.clock,
        newTraceId,
        takeModelCall: async () => {
          const taken = await dependencies.dailyAllowance.take(
            "model-calls",
            dependencies.clock.now(),
            dependencies.usageCaps.modelCallsPerDay,
          );
          if (taken === "Refused") logUsageRefusal("model-calls", newTraceId());
          return taken;
        },
        messageGuard: new WebSocketMessageGuard({
          rateLimiter: adapters.rateLimiter,
          clock: dependencies.clock,
          principalMayAct: async (accountId) => {
            const mayAct = await withAllUseCases(
              async (useCases) => (await useCases.loadPrincipal.execute(accountId)).ok,
            );
            if (!mayAct) {
              dependencies.securityEventLog.record({
                cause: "PrincipalInactive",
                method: "MESSAGE",
                path: CASE_AGENT_PATH,
                traceId: newTraceId(),
              });
            }
            return mayAct;
          },
          caseStillAssigned: (accountId) => caseAssignedTo(accountId),
          takeDailyMessage: async (accountId, at) => {
            const cap = dependencies.usageCaps.messagesPerEmployeePerDay;
            if (cap === null) return "Allowed";
            const taken = await dependencies.dailyAllowance.take(`messages:${accountId}`, at, cap);
            if (taken === "Refused") logUsageRefusal("daily-messages", newTraceId());
            return taken;
          },
          newMessageId: () => dependencies.idGenerator.newId(),
        }),
        caseEvents: () => withAllUseCases((useCases) => useCases.listCaseEvents.execute(caseId)),
        turnContext: (actor) =>
          // One transaction for what a turn needs to know (review R4-3).
          withAllUseCases(async (useCases) => ({
            events: await useCases.listCaseEvents.execute(caseId),
            state: await caseStateIn(useCases, actor),
          })),
        tools: (actor) =>
          agentTools({
            caseId,
            actor: () => actor,
            runUseCases: withAllUseCases,
            describeReason,
            newTraceId,
            caseStillAssigned: () => caseAssignedTo(actor.principalAccountId),
            logFailure: (failure) => console.error(JSON.stringify({ log: "case-tool-failed", ...failure })),
          }),
      };
    },
  };

  async function signInHandler({ request, body, traceId, useCases }: RequestContext): Promise<Response> {
    // Before any work: hashing a password is the costly step anyone can trigger (usage-guards D6).
    const address = request.headers.get("cf-connecting-ip") ?? "unknown";
    if ((await dependencies.signInRateLimiter.attempt(address, dependencies.clock.now())) === "Refused") {
      logUsageRefusal("sign-in-attempts", traceId);
      return errorResponse("rate_limited");
    }
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

  /**
   * What every case route does first: the session's principal, a well-formed case id, and, for a body, JSON whose
   * shape `schema` accepts. Answers the refusal, or the request for the use case.
   */
  async function caseRequestOf<Schema extends z.ZodType>(
    context: RequestContext,
    caseIdWritten: string,
    schema: Schema | null,
  ): Promise<
    | { readonly ok: false; readonly response: Response }
    | {
        readonly ok: true;
        readonly request: { principalAccountId: Uuid; sessionId: Uuid; traceId: string; caseId: Uuid };
        readonly body: z.infer<Schema>;
      }
  > {
    const authenticated = await authenticatePrincipal(
      context.request,
      tokens,
      context.useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return { ok: false, response: context.reject(authenticated.failure) };
    const caseId = decodeIdentifier("cse", caseIdWritten);
    if (!caseId.ok) return { ok: false, response: context.reject("CaseNotFound") };
    let body: z.infer<Schema> = undefined as z.infer<Schema>;
    if (schema !== null) {
      if (!(context.request.headers.get("content-type") ?? "").startsWith("application/json"))
        return { ok: false, response: errorResponse("invalid_request") };
      const parsed = schema.safeParse(parseJson(context.body));
      if (!parsed.success) return { ok: false, response: invalidField(parsed.error) };
      body = parsed.data;
    }
    return {
      ok: true,
      request: {
        principalAccountId: authenticated.value.principal.accountId,
        sessionId: authenticated.value.claims.sessionId,
        traceId: context.traceId,
        caseId: caseId.value,
      },
      body,
    };
  }

  /** Once the action commits, the case's agent appends its new events (case-lifecycle D21). */
  function deliverEvents(context: RequestContext, caseId: Uuid): void {
    context.afterCommit(() => dependencies.caseEventsDelivery.deliver(caseId));
  }

  /** The answer to a case or decision refusal (case-lifecycle D2, D9, D10; AU-6). */
  function refusalResponse(context: RequestContext, refusal: CaseRefusal | ActionRefusal): Response {
    switch (refusal.kind) {
      case "CaseNotFound":
      case "CaseNotAssigned":
        return context.reject(refusal.kind);
      case "NotFound":
        return errorResponse("not_found");
      case "Forbidden":
        return errorResponse("forbidden");
      case "Denied":
        return detailedErrorResponse(
          "access_denied",
          refusal.reasonCodes.map((code) => ({ error: code, error_description: describeReason(code) })),
        );
    }
  }

  /** An account id in a body; a malformed one is a 400 naming the field. */
  function accountIdIn(written: string): { ok: true; value: Uuid } | { ok: false; response: Response } {
    const decoded = decodeIdentifier("acc", written);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : {
          ok: false,
          response: detailedErrorResponse("invalid_request", [
            { error: "account_id", error_description: FIELD_DESCRIPTIONS.account_id ?? "" },
          ]),
        };
  }

  async function getCaseHandler(context: RequestContext, caseIdWritten: string): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, null);
    if (!parsed.ok) return parsed.response;
    const result = await context.useCases.getCase.execute(parsed.request);
    if ("kind" in result) return refusalResponse(context, result);
    return jsonResponse(200, caseBody(result));
  }

  async function setSubjectHandler(context: RequestContext, caseIdWritten: string): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, accountBody);
    if (!parsed.ok) return parsed.response;
    const accountId = accountIdIn(parsed.body.account_id);
    if (!accountId.ok) return accountId.response;
    const result = await context.useCases.setCaseSubject.execute({
      ...parsed.request,
      accountId: accountId.value,
    });
    switch (result.kind) {
      case "SubjectSet":
        deliverEvents(context, parsed.request.caseId);
        return noContent();
      case "SubjectAlreadySet":
        return detailedErrorResponse("conflict", [
          { error: "subject_already_set", error_description: "The case's subject is already set." },
        ]);
      default:
        return refusalResponse(context, result);
    }
  }

  async function setContactHandler(context: RequestContext, caseIdWritten: string): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, accountBody);
    if (!parsed.ok) return parsed.response;
    const accountId = accountIdIn(parsed.body.account_id);
    if (!accountId.ok) return accountId.response;
    const result = await context.useCases.setCaseContact.execute({
      ...parsed.request,
      accountId: accountId.value,
    });
    switch (result.kind) {
      case "ContactSet":
        deliverEvents(context, parsed.request.caseId);
        return noContent();
      case "NotAPerson":
        return detailedErrorResponse("invalid_request", [
          { error: "account_id", error_description: "The contact must be a person's own account." },
        ]);
      default:
        return refusalResponse(context, result);
    }
  }

  async function authenticateContactHandler(
    context: RequestContext,
    caseIdWritten: string,
  ): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, authenticationBody);
    if (!parsed.ok) return parsed.response;
    const result = await context.useCases.authenticateContact.execute({ ...parsed.request, ...parsed.body });
    switch (result.kind) {
      case "Authenticated":
        deliverEvents(context, parsed.request.caseId);
        return noContent();
      case "AuthenticationFailed":
        deliverEvents(context, parsed.request.caseId);
        return detailedErrorResponse("conflict", [
          {
            error: "contact_authentication_failed",
            error_description: "The contact did not pass authentication.",
          },
        ]);
      case "ContactNotSet":
        return detailedErrorResponse("conflict", [
          { error: "contact_not_set", error_description: "The case has no contact." },
        ]);
      case "MethodNotAccepted":
        return detailedErrorResponse("invalid_request", [
          { error: "method", error_description: "This method is not accepted." },
        ]);
      case "MethodNotOfKind":
        return detailedErrorResponse("invalid_request", [
          { error: "method", error_description: "The method is not of this kind." },
        ]);
      default:
        return refusalResponse(context, result);
    }
  }

  async function closeCaseHandler(context: RequestContext, caseIdWritten: string): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, closureBody);
    if (!parsed.ok) return parsed.response;
    const result = await context.useCases.closeCase.execute({
      ...parsed.request,
      reason: parsed.body.close_reason,
      summary: parsed.body.summary,
    });
    if (result.kind === "SummaryHasEmail")
      return detailedErrorResponse("invalid_request", [
        { error: "summary", error_description: SUMMARY_WITH_EMAIL },
      ]);
    if (result.kind !== "Closed") return refusalResponse(context, result);
    const caseId = parsed.request.caseId;
    context.afterCommit(() => dependencies.caseWebSocketConnections.closeAll(caseId));
    const messageIds = result.outboxMessageIds;
    if (messageIds.length > 0) context.afterCommit(() => relay(messageIds));
    return noContent();
  }

  /** A change request's id in a path; a malformed one is not found (api.md §6). */
  function changeRequestIdIn(written: string): Uuid | null {
    const decoded = decodeIdentifier("chg", written);
    return decoded.ok ? decoded.value : null;
  }

  async function getChangeRequestHandler(
    context: RequestContext,
    caseIdWritten: string,
    changeRequestIdWritten: string,
  ): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, null);
    if (!parsed.ok) return parsed.response;
    const changeRequestId = changeRequestIdIn(changeRequestIdWritten);
    if (changeRequestId === null) return errorResponse("not_found");
    const result = await context.useCases.getChangeRequest.execute({ ...parsed.request, changeRequestId });
    if (result.kind === "ChangeRequestNotFound") return errorResponse("not_found");
    if (result.kind !== "Found") return refusalResponse(context, result);
    const request = result.changeRequest;
    return jsonResponse(200, {
      change_request_id: encodeIdentifier("chg", request.changeRequestId),
      change_kind: request.change.kind,
      status: request.status,
      status_reason: request.statusReason,
      parameters: parametersBody(request.change),
      diff: diffBody(request.diff),
      preview: {
        outcome: request.previewOutcome,
        reasons: reasonsBody(request.previewReasonCodes, describeReason),
      },
      approval:
        result.approval === null
          ? null
          : {
              approval_id: encodeIdentifier("apr", result.approval.approvalId),
              approval_status: result.approval.status,
              expires_at: result.approval.expiresAt.toISOString(),
            },
      requested_at: request.requestedAt.toISOString(),
      confirmed_at: request.confirmedAt?.toISOString() ?? null,
      applied_at: request.appliedAt?.toISOString() ?? null,
    });
  }

  async function confirmChangeRequestHandler(
    context: RequestContext,
    caseIdWritten: string,
    changeRequestIdWritten: string,
  ): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, emptyBody);
    if (!parsed.ok) return parsed.response;
    const changeRequestId = changeRequestIdIn(changeRequestIdWritten);
    if (changeRequestId === null) return errorResponse("not_found");
    const result = await context.useCases.confirmChangeRequest.execute({
      ...parsed.request,
      changeRequestId,
    });
    switch (result.kind) {
      case "Confirmed": {
        deliverEvents(context, parsed.request.caseId);
        const messageIds = result.outboxMessageIds;
        if (messageIds.length > 0) context.afterCommit(() => relay(messageIds));
        return result.response.status === "Applied"
          ? jsonResponse(200, { status: "Applied" })
          : jsonResponse(202, {
              status: "AwaitingApproval",
              approval_id: encodeIdentifier("apr", result.response.approvalId),
            });
      }
      case "Stale":
        deliverEvents(context, parsed.request.caseId);
        return detailedErrorResponse("conflict", [
          {
            error: "stale_change_request",
            error_description: "The account changed since the request was prepared: prepare it again.",
          },
        ]);
      case "NotAwaitingConfirmation":
        return detailedErrorResponse("conflict", [
          {
            error: "change_request_not_awaiting_confirmation",
            error_description: "The change request is no longer awaiting confirmation.",
          },
        ]);
      case "ChangeRequestNotFound":
        return errorResponse("not_found");
      default:
        return refusalResponse(context, result);
    }
  }

  async function cancelChangeRequestHandler(
    context: RequestContext,
    caseIdWritten: string,
    changeRequestIdWritten: string,
  ): Promise<Response> {
    const parsed = await caseRequestOf(context, caseIdWritten, emptyBody);
    if (!parsed.ok) return parsed.response;
    const changeRequestId = changeRequestIdIn(changeRequestIdWritten);
    if (changeRequestId === null) return errorResponse("not_found");
    const result = await context.useCases.cancelChangeRequest.execute({ ...parsed.request, changeRequestId });
    switch (result.kind) {
      case "Canceled":
        deliverEvents(context, parsed.request.caseId);
        return jsonResponse(200, { status: "Canceled" });
      case "NotAwaitingConfirmation":
        return detailedErrorResponse("conflict", [
          {
            error: "change_request_not_awaiting_confirmation",
            error_description: "The change request is no longer awaiting confirmation.",
          },
        ]);
      case "ChangeRequestNotFound":
        return errorResponse("not_found");
      default:
        return refusalResponse(context, result);
    }
  }

  /** The approvals panel's list (D7): `GET /api/approvals?status=Pending`, for holders of `approval.decide`. */
  async function approvalsHandler(context: RequestContext): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      context.request,
      tokens,
      context.useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return context.reject(authenticated.failure);
    if (new URL(context.request.url).searchParams.get("status") !== "Pending")
      return detailedErrorResponse("invalid_request", [
        { error: "status", error_description: "Only status=Pending is supported." },
      ]);
    const result = await context.useCases.listPendingApprovals.execute({
      principalAccountId: authenticated.value.principal.accountId,
      sessionId: authenticated.value.claims.sessionId,
      traceId: context.traceId,
    });
    if (result.kind === "Forbidden") return errorResponse("forbidden");
    const person = (who: { readonly accountId: Uuid; readonly displayName: string | null }) => ({
      account_id: encodeIdentifier("iac", who.accountId),
      display_name: who.displayName,
    });
    return jsonResponse(200, {
      approvals: result.approvals.map((approval) => ({
        approval_id: encodeIdentifier("apr", approval.approvalId),
        expires_at: approval.expiresAt.toISOString(),
        change_request_id: encodeIdentifier("chg", approval.changeRequestId),
        change_kind: approval.change.kind,
        parameters: parametersBody(approval.change),
        preview_reasons: reasonsBody(approval.previewReasonCodes, describeReason),
        subject: {
          account_id: encodeIdentifier("acc", approval.subject.accountId),
          display_name: approval.subject.displayName,
        },
        requested_by: person(approval.requestedBy),
        confirmed_by: approval.confirmedBy === null ? null : person(approval.confirmedBy),
        requested_at: approval.requestedAt.toISOString(),
      })),
    });
  }

  /** A supervisor's decision (D7, D9): `POST /api/approvals/{id}/decision`. */
  async function decideApprovalHandler(
    context: RequestContext,
    approvalIdWritten: string,
  ): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      context.request,
      tokens,
      context.useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return context.reject(authenticated.failure);
    if (!(context.request.headers.get("content-type") ?? "").startsWith("application/json"))
      return errorResponse("invalid_request");
    const parsed = decisionBody.safeParse(parseJson(context.body));
    if (!parsed.success) return invalidField(parsed.error);
    const body = parsed.data;
    const invalid = (field: string) =>
      detailedErrorResponse("invalid_request", [
        { error: field, error_description: FIELD_DESCRIPTIONS[field] ?? "The field is not allowed." },
      ]);
    if (body.decision === "Denied" && body.decision_reason === undefined) return invalid("decision_reason");
    if (body.decision === "Denied" && body.decision_reason === "Other" && body.decision_comment === undefined)
      return invalid("decision_comment");
    if (
      body.decision === "Approved" &&
      (body.decision_reason !== undefined || body.decision_comment !== undefined)
    )
      return invalid(body.decision_reason !== undefined ? "decision_reason" : "decision_comment");
    const approvalId = decodeIdentifier("apr", approvalIdWritten);
    if (!approvalId.ok) return errorResponse("not_found");
    const result = await context.useCases.decideApproval.execute({
      principalAccountId: authenticated.value.principal.accountId,
      sessionId: authenticated.value.claims.sessionId,
      traceId: context.traceId,
      approvalId: approvalId.value,
      decision: body.decision,
      reason: (body.decision_reason ?? null) as DenialReason | null,
      comment: body.decision_comment ?? null,
    });
    switch (result.kind) {
      case "Decided": {
        deliverEvents(context, result.caseId);
        const messageIds = result.outboxMessageIds;
        context.afterCommit(() => relay(messageIds));
        return jsonResponse(200, { approval_status: result.status });
      }
      case "NotFound":
        return errorResponse("not_found");
      case "NotPending":
        return detailedErrorResponse("conflict", [
          { error: "approval_not_pending", error_description: "The approval is no longer pending." },
        ]);
      case "Denied":
        return detailedErrorResponse(
          "access_denied",
          result.reasonCodes.map((code) => ({ error: code, error_description: describeReason(code) })),
        );
    }
  }

  /**
   * The case panel's account search (case-lifecycle D18): `GET /api/accounts?query=…`, the assistant's lookup for
   * the session's principal, answered as the tool answers it.
   */
  async function accountSearchHandler(context: RequestContext): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      context.request,
      tokens,
      context.useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return context.reject(authenticated.failure);
    // Before any work: each search may decide and audit up to 50 accounts (explain-access D14).
    const attempt = await dependencies.searchRateLimiter.attempt(
      authenticated.value.principal.accountId,
      dependencies.clock.now(),
    );
    if (attempt === "Refused") return errorResponse("rate_limited");
    const query = new URL(context.request.url).searchParams.get("query") ?? "";
    if (query.length > 320)
      return detailedErrorResponse("invalid_request", [
        { error: "query", error_description: "The query is too long." },
      ]);
    const result = await context.useCases.findCustomerAccount.execute({
      principalAccountId: authenticated.value.principal.accountId,
      sessionId: authenticated.value.claims.sessionId,
      caseId: null,
      toolCallId: null,
      traceId: context.traceId,
      query,
    });
    switch (result.kind) {
      case "Found":
      case "Ambiguous":
        return jsonResponse(200, lookupOutputOf(result));
      case "QueryTooShort":
        return detailedErrorResponse("invalid_request", [
          {
            error: "query",
            error_description: `The query needs at least ${MINIMUM_QUERY_LENGTH} characters.`,
          },
        ]);
      default:
        return refusalResponse(context, result);
    }
  }

  /** The closed cases of an account (case-lifecycle D17): `GET /api/cases?subject=…&status=closed`. */
  async function closedCasesHandler(context: RequestContext): Promise<Response> {
    const authenticated = await authenticatePrincipal(
      context.request,
      tokens,
      context.useCases.loadPrincipal,
      dependencies.clock.now(),
    );
    if (!authenticated.ok) return context.reject(authenticated.failure);
    const query = new URL(context.request.url).searchParams;
    if (query.get("status") !== "closed")
      return detailedErrorResponse("invalid_request", [
        { error: "status", error_description: "Only status=closed is supported." },
      ]);
    const accountId = accountIdIn(query.get("subject") ?? "");
    if (!accountId.ok)
      return detailedErrorResponse("invalid_request", [
        { error: "subject", error_description: "Must be an account id." },
      ]);
    const result = await context.useCases.listClosedCases.execute({
      principalAccountId: authenticated.value.principal.accountId,
      sessionId: authenticated.value.claims.sessionId,
      caseId: null,
      toolCallId: null,
      traceId: context.traceId,
      accountId: accountId.value,
    });
    if (result.kind !== "Listed") return refusalResponse(context, result);
    return jsonResponse(200, {
      cases: result.cases.map((past) => ({
        case_id: encodeIdentifier("cse", past.caseId),
        closed_at: past.closedAt.toISOString(),
        closed_by: {
          account_id: encodeIdentifier("iac", past.closedBy.accountId),
          display_name: past.closedBy.displayName,
        },
        close_reason: past.closeReason,
        summary: past.summary,
      })),
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
  readonly getCase: GetCase;
  readonly setCaseSubject: SetCaseSubject;
  readonly setCaseContact: SetCaseContact;
  readonly authenticateContact: AuthenticateContact;
  readonly closeCase: CloseCase;
  readonly listClosedCases: ListClosedCases;
  readonly listCaseEvents: ListCaseEvents;
  readonly getChangeRequest: GetChangeRequest;
  readonly confirmChangeRequest: ConfirmChangeRequest;
  readonly cancelChangeRequest: CancelChangeRequest;
  readonly listPendingApprovals: ListPendingApprovals;
  readonly decideApproval: DecideApproval;
  readonly applyApprovedChange: ApplyApprovedChange;
  readonly expireApproval: ExpireApproval;
  readonly recordGrantExpiries: RecordGrantExpiries;
  readonly changeRequests: PostgresChangeRequestRepository;
  readonly outbox: PostgresTransactionalOutbox;
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
  const cases = new PostgresCaseRepository(connection);
  const enforcement = new ReadEnforcement({
    decider: caseWork.decider,
    audit,
    getCustomerAccount: caseWork.getCustomerAccount,
    cases,
  });
  const check = new CaseAssigneeCheck({ cases });
  const actions = new CaseActionEnforcement({
    decider: caseWork.decider,
    audit,
    getCustomerAccount: caseWork.getCustomerAccount,
  });
  const changeRequests = new PostgresChangeRequestRepository(connection);
  const outbox = new PostgresTransactionalOutbox(connection);
  const grants = new PostgresGrantRepository(connection);
  const getGrant = new GetGrant({ grants });
  const diffs = new EntitlementDiffs({ computeEffectiveEntitlements: caseWork.computeEffectiveEntitlements });
  const applyChangeRequest = new ApplyChangeRequest({
    diffs,
    getGrant,
    changeGrants: new ChangeGrants({ grants }),
    accountVersions: caseWork.accountVersions,
    changeRequests,
    ids,
    clock,
  });
  return {
    prepareChangeRequest: new PrepareChangeRequest({
      check,
      enforcement: actions,
      changeRequests,
      diffs,
      getGrant,
      getCatalog: caseWork.getCatalog,
      ids,
      clock,
    }),
    getChangeRequest: new GetChangeRequest({ check, enforcement: actions, changeRequests }),
    confirmChangeRequest: new ConfirmChangeRequest({
      check,
      enforcement: actions,
      changeRequests,
      applyChangeRequest,
      getGrant,
      outbox,
      ids,
      clock,
      approvalWindowMilliseconds: dependencies.approvalWindowMilliseconds,
    }),
    cancelChangeRequest: new CancelChangeRequest({
      check,
      enforcement: actions,
      changeRequests,
      outbox,
      ids,
      clock,
    }),
    listPendingApprovals: new ListPendingApprovals({
      decider: caseWork.decider,
      audit,
      changeRequests,
      getCustomerAccount: caseWork.getCustomerAccount,
      getInternalAccountNames: new GetInternalAccountNames({ accounts }),
      clock,
    }),
    decideApproval: new DecideApproval({
      decider: caseWork.decider,
      audit,
      changeRequests,
      outbox,
      ids,
      clock,
    }),
    applyApprovedChange: new ApplyApprovedChange({
      decider: caseWork.decider,
      audit,
      changeRequests,
      applyChangeRequest,
      getGrant,
      clock,
    }),
    expireApproval: new ExpireApproval({ decider: caseWork.decider, audit, changeRequests, clock }),
    recordGrantExpiries: new RecordGrantExpiries({ grants, decider: caseWork.decider, audit }),
    changeRequests,
    outbox,
    getCase: new GetCase({ check, enforcement, listAccountRoles: caseWork.listAccountRoles }),
    setCaseSubject: new SetCaseSubject({ check, enforcement: actions, cases, ids, clock }),
    setCaseContact: new SetCaseContact({ check, enforcement: actions, cases, ids, clock }),
    authenticateContact: new AuthenticateContact({ check, enforcement: actions, cases, clock }),
    closeCase: new CloseCase({
      check,
      enforcement: actions,
      cases,
      changeRequests,
      outbox,
      audit,
      ids,
      clock,
    }),
    listCaseEvents: new ListCaseEvents({
      listCaseRecords: new ListCaseRecords({ records: new PostgresCaseRecordRepository(connection) }),
      getInternalAccountNames: new GetInternalAccountNames({ accounts }),
      cases,
    }),
    listClosedCases: new ListClosedCases({
      enforcement,
      cases,
      getInternalAccountNames: new GetInternalAccountNames({ accounts }),
    }),
    proposeCaseSubject: new ProposeCaseSubject({
      enforcement,
      cases,
      computeEffectiveEntitlements: caseWork.computeEffectiveEntitlements,
      clock,
    }),
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
      findLowestPlanIncluding: caseWork.findLowestPlanIncluding,
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

import { assertNever, failure, type Result, success } from "../../../../kernel/result.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { SessionClaims, SessionTokenIssuer } from "../../../../port/session-token.ts";
import type { UnitOfWork } from "../../../../port/unit-of-work.ts";
import { decideRenewal, secondsUntil } from "../model/session.ts";
import type { LoadPrincipal } from "./load-principal.ts";

export type Renewal =
  | { readonly kind: "Unchanged" }
  | { readonly kind: "Renewed"; readonly token: string; readonly lifetimeSeconds: number };

export type RenewalRefusal = "PrincipalMayNotAct" | "AbsoluteLifetimeReached";

/**
 * Keeps a session alive (CM-16): the principal is re-checked, then the token is re-issued past half-life.
 *
 * @requires `claims` come from a verified, unexpired token.
 * @ensures A re-issued token keeps the session id and authentication time, with a new token id.
 * @ensures A renewal that changes nothing writes no audit record; every other outcome writes exactly one.
 */
export class RenewSession {
  readonly #loadPrincipal: LoadPrincipal;
  readonly #tokens: SessionTokenIssuer;
  readonly #audit: AuditRecorder;
  readonly #unitOfWork: UnitOfWork;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  constructor(dependencies: {
    readonly loadPrincipal: LoadPrincipal;
    readonly tokens: SessionTokenIssuer;
    readonly audit: AuditRecorder;
    readonly unitOfWork: UnitOfWork;
    readonly clock: Clock;
    readonly ids: IdGenerator;
  }) {
    this.#loadPrincipal = dependencies.loadPrincipal;
    this.#tokens = dependencies.tokens;
    this.#audit = dependencies.audit;
    this.#unitOfWork = dependencies.unitOfWork;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  execute(claims: SessionClaims, traceId: string): Promise<Result<Renewal, RenewalRefusal>> {
    return this.#unitOfWork.run(async () => {
      const record = (outcome: "Succeeded" | "Failed", reasons: readonly string[]) =>
        this.#audit.record({
          actorAccountId: claims.accountId,
          sessionId: claims.sessionId,
          traceId,
          actionKey: "session.renew",
          outcome,
          policySetVersion: null,
          subjectAccountId: null,
          caseId: null,
          changeRequestId: null,
          detail: {},
          participants: [],
          reasons,
        });

      const principal = await this.#loadPrincipal.execute(claims.accountId);
      if (!principal.ok) {
        const reasons = principal.failure.kind === "MayNotAct" ? principal.failure.reasons : [];
        await record("Failed", ["session.principal-inactive", ...reasons]);
        return failure("PrincipalMayNotAct" as const);
      }

      const now = this.#clock.now();
      const decision = decideRenewal(claims, now);
      switch (decision.kind) {
        case "NoChange":
          return success({ kind: "Unchanged" as const });
        case "RefuseAtAbsoluteLifetime":
          await record("Failed", ["session.absolute-lifetime-reached"]);
          return failure("AbsoluteLifetimeReached" as const);
        case "Renew": {
          const token = await this.#tokens.issue({
            accountId: claims.accountId,
            sessionId: claims.sessionId,
            tokenId: this.#ids.newId(),
            authenticatedAt: claims.authenticatedAt,
            issuedAt: now,
            expiresAt: decision.expiresAt,
          });
          await record("Succeeded", []);
          return success({
            kind: "Renewed" as const,
            token,
            lifetimeSeconds: secondsUntil(decision.expiresAt, now),
          });
        }
        default:
          return assertNever(decision);
      }
    });
  }
}

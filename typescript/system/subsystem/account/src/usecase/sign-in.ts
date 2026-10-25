import { normalizeEmail } from "../../../../kernel/email.ts";
import { ABSENT_UUID, type Uuid } from "../../../../kernel/identifier.ts";
import { failure, type Result, success } from "../../../../kernel/result.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { IdentifierHasher } from "../../../../port/identifier-hasher.ts";
import type { SessionTokenIssuer } from "../../../../port/session-token.ts";
import type { UnitOfWork } from "../../../../port/unit-of-work.ts";
import type { VerifyEmployeeCredential } from "../../../internal-identity/src/usecase/verify-employee-credential.ts";
import { secondsUntil, TOKEN_LIFETIME_MILLISECONDS } from "../model/session.ts";
import type { InternalAccountRepository } from "./internal-account-repository.ts";
import type { LoadPrincipal } from "./load-principal.ts";

export interface SignInRequest {
  readonly email: string;
  readonly password: string;
  /** The account the session should act as; may be omitted when the identity has exactly one (AN-5). */
  readonly declaredAccountId: Uuid | null;
  readonly traceId: string;
}

export interface SignedIn {
  readonly token: string;
  /** The token's lifetime in seconds: the session cookie's Max-Age. */
  readonly lifetimeSeconds: number;
}

/**
 * Authenticates an employee and binds a new session to their internal account (AN-5, CM-16).
 *
 * @ensures Succeeds only for a matching password, an active identity, and an account with no unreleased hold.
 * @ensures Every failure is the same `InvalidCredentials`, whatever the cause (no account enumeration, AU-6).
 * @ensures Every attempt runs the same password derivation and the same queries, whatever the cause, so
 *          response time does not tell a correct password for a disabled employee from a wrong one.
 * @ensures Exactly one audit record per attempt; a failed attempt has no actor and records the email only as
 *          a keyed hash (rule every-decision-is-audited).
 */
export class SignIn {
  readonly #verifyEmployeeCredential: VerifyEmployeeCredential;
  readonly #loadPrincipal: LoadPrincipal;
  readonly #accounts: InternalAccountRepository;
  readonly #tokens: SessionTokenIssuer;
  readonly #audit: AuditRecorder;
  readonly #identifierHasher: IdentifierHasher;
  readonly #unitOfWork: UnitOfWork;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  constructor(dependencies: {
    readonly verifyEmployeeCredential: VerifyEmployeeCredential;
    readonly loadPrincipal: LoadPrincipal;
    readonly accounts: InternalAccountRepository;
    readonly tokens: SessionTokenIssuer;
    readonly audit: AuditRecorder;
    readonly identifierHasher: IdentifierHasher;
    readonly unitOfWork: UnitOfWork;
    readonly clock: Clock;
    readonly ids: IdGenerator;
  }) {
    this.#verifyEmployeeCredential = dependencies.verifyEmployeeCredential;
    this.#loadPrincipal = dependencies.loadPrincipal;
    this.#accounts = dependencies.accounts;
    this.#tokens = dependencies.tokens;
    this.#audit = dependencies.audit;
    this.#identifierHasher = dependencies.identifierHasher;
    this.#unitOfWork = dependencies.unitOfWork;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  execute(request: SignInRequest): Promise<Result<SignedIn, "InvalidCredentials">> {
    return this.#unitOfWork.run(async () => {
      const email = normalizeEmail(request.email);
      const refuse = async (reasons: readonly string[]) => {
        await this.#audit.record({
          actorAccountId: null,
          sessionId: null,
          traceId: request.traceId,
          actionKey: "session.sign-in",
          outcome: "Failed",
          policySetVersion: null,
          subjectAccountId: null,
          caseId: null,
          changeRequestId: null,
          detail: { attempted_identifier_hmac: await this.#identifierHasher.hash(email) },
          participants: [],
          reasons: ["session.invalid-credentials", ...reasons],
        });
        return failure("InvalidCredentials" as const);
      };

      const verified = await this.#verifyEmployeeCredential.execute(email, request.password);
      const account = await this.#accounts.findByIdentity(
        verified.ok ? verified.value.internalIdentityId : ABSENT_UUID,
      );
      const principal = await this.#loadPrincipal.execute(account?.accountId ?? ABSENT_UUID);
      if (!verified.ok || account === null) return refuse([]);
      if (request.declaredAccountId !== null && request.declaredAccountId !== account.accountId)
        return refuse([]);
      if (!principal.ok)
        return refuse(principal.failure.kind === "MayNotAct" ? principal.failure.reasons : []);

      const now = this.#clock.now();
      const sessionId = this.#ids.newId();
      const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MILLISECONDS);
      const token = await this.#tokens.issue({
        accountId: account.accountId,
        sessionId,
        tokenId: this.#ids.newId(),
        authenticatedAt: now,
        issuedAt: now,
        expiresAt,
      });
      await this.#audit.record({
        actorAccountId: account.accountId,
        sessionId,
        traceId: request.traceId,
        actionKey: "session.sign-in",
        outcome: "Succeeded",
        policySetVersion: null,
        subjectAccountId: null,
        caseId: null,
        changeRequestId: null,
        detail: {},
        participants: [],
        reasons: [],
      });
      return success({ token, lifetimeSeconds: secondsUntil(expiresAt, now) });
    });
  }
}

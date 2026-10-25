import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { SessionClaims } from "../../../../port/session-token.ts";
import type { UnitOfWork } from "../../../../port/unit-of-work.ts";

/**
 * Ends a session from the browser's side: the cookie is cleared by the caller. The token itself stays valid
 * until it expires (production-readiness, ending sessions).
 *
 * @ensures Exactly one audit record, `session.sign-out`, attributed to the session's account.
 */
export class SignOut {
  readonly #audit: AuditRecorder;
  readonly #unitOfWork: UnitOfWork;

  constructor(dependencies: { readonly audit: AuditRecorder; readonly unitOfWork: UnitOfWork }) {
    this.#audit = dependencies.audit;
    this.#unitOfWork = dependencies.unitOfWork;
  }

  execute(claims: SessionClaims, traceId: string): Promise<void> {
    return this.#unitOfWork.run(() =>
      this.#audit.record({
        actorAccountId: claims.accountId,
        sessionId: claims.sessionId,
        traceId,
        actionKey: "session.sign-out",
        outcome: "Succeeded",
        policySetVersion: null,
        subjectAccountId: null,
        caseId: null,
        changeRequestId: null,
        detail: {},
        participants: [],
        reasons: [],
      }),
    );
  }
}

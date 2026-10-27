import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { TransactionalOutbox } from "../../../../port/transactional-outbox.ts";
import { cancelPending } from "./cancel-change-request.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { CaseRepository, CloseReason } from "./case-repository.ts";
import type { ChangeRequestRepository } from "./change-request-repository.ts";
import { changeDetail } from "./prepare-change-request.ts";

export type CloseCaseResult =
  | { readonly kind: "Closed"; readonly outboxMessageIds: readonly Uuid[] }
  | CaseRefusal
  | ActionRefusal;

/** Closes a case with the reviewed summary (SU-7, case-lifecycle D7, D8). */
export class CloseCase {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #cases: CaseRepository;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #outbox: TransactionalOutbox;
  readonly #audit: AuditRecorder;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly cases: CaseRepository;
    readonly changeRequests: ChangeRequestRepository;
    readonly outbox: TransactionalOutbox;
    readonly audit: AuditRecorder;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
    this.#changeRequests = dependencies.changeRequests;
    this.#outbox = dependencies.outbox;
    this.#audit = dependencies.audit;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Only the case's current assignee; `case.close` decided alone, without `account.read` on the subject
   *          (D19): closing reads nothing about the account. The records name the subject.
   * @ensures Allowed: closing fields and the summary as given, and the assignment ended, in the caller's transaction.
   *          What is pending ends with it (grants-and-approvals D14): change requests awaiting confirmation are
   *          canceled; those awaiting approval are canceled with their approvals, and an outbox message stops each
   *          approval process; each cancellation is recorded (`change-request.cancel`). The caller closes the case's
   *          WebSocket connections and delivers the outbox messages once the transaction commits.
   * @ensures A case closed meanwhile by a concurrent request is `CaseNotAssigned`, `Failed` (`support.case-closed`).
   */
  async execute(
    request: CaseActionRequest & { readonly reason: CloseReason; readonly summary: string },
  ): Promise<CloseCaseResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const acted = await this.#enforcement.act<
      | { readonly kind: "Closed"; readonly outboxMessageIds: readonly Uuid[] }
      | { readonly kind: "CaseNotAssigned" }
    >(
      request,
      "case.close",
      assigned.supportCase.subjectAccountId,
      async (_account, decision) => {
        const at = this.#clock.now();
        const closed = await this.#cases.close(request.caseId, {
          at,
          by: request.principalAccountId,
          reason: request.reason,
          summary: request.summary,
        });
        // Closed meanwhile by a concurrent request: no longer this CSR's case (D9).
        if (!closed)
          return {
            outcome: "Failed",
            reasonCode: "support.case-closed",
            result: { kind: "CaseNotAssigned" } as const,
          };
        const outboxMessageIds: Uuid[] = [];
        const pending = await this.#changeRequests.ofCase(request.caseId, [
          "AwaitingConfirmation",
          "AwaitingApproval",
        ]);
        for (const changeRequest of pending) {
          const messages = await cancelPending(
            this.#changeRequests,
            this.#outbox,
            this.#ids,
            at,
            changeRequest,
          );
          if (messages === null) continue;
          outboxMessageIds.push(...messages);
          await this.#audit.record({
            actorAccountId: request.principalAccountId,
            sessionId: request.sessionId,
            traceId: request.traceId,
            actionKey: "change-request.cancel",
            outcome: "Succeeded",
            policySetVersion: decision.policySetVersion,
            subjectAccountId: changeRequest.subjectAccountId,
            caseId: request.caseId,
            changeRequestId: changeRequest.changeRequestId,
            detail: { ...changeDetail(changeRequest.change, null), cause: "CaseClosed" },
            participants: [],
            reasons: [],
          });
        }
        return { outcome: "Succeeded", result: { kind: "Closed", outboxMessageIds } as const };
      },
      { readsAccount: false },
    );
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

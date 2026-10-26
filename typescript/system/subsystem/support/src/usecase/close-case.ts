import type { Clock } from "../../../../port/clock.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { CaseRepository, CloseReason } from "./case-repository.ts";

export type CloseCaseResult = { readonly kind: "Closed" } | CaseRefusal | ActionRefusal;

/** Closes a case with the reviewed summary (SU-7, case-lifecycle D7, D8). */
export class CloseCase {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #cases: CaseRepository;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly cases: CaseRepository;
    readonly clock: Clock;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Only the case's current assignee; `case.close` decided alone, without `account.read` on the subject
   *          (D19): closing reads nothing about the account. The records name the subject.
   * @ensures Allowed: closing fields and the summary as given, and the assignment ended, in the caller's transaction.
   *          Nothing else is pending before grants-and-approvals. The caller closes the case's WebSocket
   *          connections once the transaction commits.
   * @ensures A case closed meanwhile by a concurrent request is `CaseNotAssigned`, `Failed` (`support.case-closed`).
   */
  async execute(
    request: CaseActionRequest & { readonly reason: CloseReason; readonly summary: string },
  ): Promise<CloseCaseResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const acted = await this.#enforcement.act<
      { readonly kind: "Closed" } | { readonly kind: "CaseNotAssigned" }
    >(
      request,
      "case.close",
      assigned.supportCase.subjectAccountId,
      async () =>
        (await this.#cases.close(request.caseId, {
          at: this.#clock.now(),
          by: request.principalAccountId,
          reason: request.reason,
          summary: request.summary,
        }))
          ? { outcome: "Succeeded", result: { kind: "Closed" } as const }
          : // Closed meanwhile by a concurrent request: no longer this CSR's case (D9).
            {
              outcome: "Failed",
              reasonCode: "support.case-closed",
              result: { kind: "CaseNotAssigned" } as const,
            },
      { readsAccount: false },
    );
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

import type { Uuid } from "../../../../kernel/identifier.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { CaseRepository } from "./case-repository.ts";

export type SetCaseSubjectResult =
  | { readonly kind: "SubjectSet" }
  | { readonly kind: "SubjectAlreadySet" }
  | CaseRefusal
  | ActionRefusal;

/** Sets the account a case is about, by the CSR's click (SU-2, SU-9, case-lifecycle D1, D2). */
export class SetCaseSubject {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #cases: CaseRepository;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly cases: CaseRepository;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
  }

  /**
   * @ensures Only the case's assignee; `case.set-subject` decided with `account.read` on the account (D2).
   * @ensures Set once, atomically: when the case already has a subject, `SubjectAlreadySet` with a `Failed` record
   *          (`support.subject-already-set`), and the subject unchanged.
   */
  async execute(request: CaseActionRequest & { readonly accountId: Uuid }): Promise<SetCaseSubjectResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const acted = await this.#enforcement.act<
      { readonly kind: "SubjectSet" } | { readonly kind: "SubjectAlreadySet" }
    >(request, "case.set-subject", request.accountId, async () =>
      (await this.#cases.setSubjectIfUnset(request.caseId, request.accountId))
        ? { outcome: "Succeeded", result: { kind: "SubjectSet" } as const }
        : {
            outcome: "Failed",
            reasonCode: "support.subject-already-set",
            result: { kind: "SubjectAlreadySet" } as const,
          },
    );
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

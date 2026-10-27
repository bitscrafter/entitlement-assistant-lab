import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
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
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly cases: CaseRepository;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /** Keeps the account's name for the case's events, out of the audit chain (D21; review R5-1): its id goes there. */
  async #keepName(caseId: Uuid, accountId: Uuid, displayName: string): Promise<{ readonly name_id: string }> {
    const nameId = this.#ids.newId();
    // Cut by code point to the table's bound: a stored name has no maximum, and must never block the action (R6-1).
    const kept = Array.from(displayName).slice(0, 500).join("");
    await this.#cases.recordAccountName(nameId, {
      caseId,
      accountId,
      displayName: kept,
      at: this.#clock.now(),
    });
    return { name_id: nameId };
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
    >(request, "case.set-subject", request.accountId, async (account) =>
      (await this.#cases.setSubjectIfUnset(request.caseId, request.accountId))
        ? {
            outcome: "Succeeded",
            result: { kind: "SubjectSet" } as const,
            // The name as stored now, which this decision let the CSR read: the case event shows it (D21).
            detail: await this.#keepName(request.caseId, request.accountId, account?.displayName ?? ""),
          }
        : {
            outcome: "Failed",
            reasonCode: "support.subject-already-set",
            result: { kind: "SubjectAlreadySet" } as const,
          },
    );
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

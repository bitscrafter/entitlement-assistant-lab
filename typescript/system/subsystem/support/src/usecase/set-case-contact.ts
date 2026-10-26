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

export type SetCaseContactResult =
  | { readonly kind: "ContactSet" }
  | { readonly kind: "NotAPerson" }
  | CaseRefusal
  | ActionRefusal;

/** Records who reached support: a person's own customer account (SU-2, SU-10, case-lifecycle D3). */
export class SetCaseContact {
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
   * @ensures Only the case's assignee; `case.set-contact` decided with `account.read` on the contact (D3).
   * @ensures An account that is not an individual's is `NotAPerson`, with a `Failed` record
   *          (`support.contact-not-a-person`), once the read is allowed; nothing changes.
   * @ensures Otherwise the contact is set and any authentication cleared, even for the same contact (SU-10).
   */
  async execute(request: CaseActionRequest & { readonly accountId: Uuid }): Promise<SetCaseContactResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const acted = await this.#enforcement.act<
      { readonly kind: "ContactSet" } | { readonly kind: "NotAPerson" }
    >(request, "case.set-contact", request.accountId, async (account) => {
      if (account?.customerKind !== "Individual") {
        return {
          outcome: "Failed",
          reasonCode: "support.contact-not-a-person",
          result: { kind: "NotAPerson" } as const,
        };
      }
      await this.#cases.setContact(request.caseId, request.accountId);
      return {
        outcome: "Succeeded",
        result: { kind: "ContactSet" } as const,
        // The name as stored now, which this decision let the CSR read: the case event shows it (D21).
        detail: await this.#keepName(request.caseId, request.accountId, account.displayName),
      };
    });
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

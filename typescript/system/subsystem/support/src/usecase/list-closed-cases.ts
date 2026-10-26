import type { Uuid } from "../../../../kernel/identifier.ts";
import type { GetInternalAccountNames } from "../../../account/src/usecase/get-internal-account-names.ts";
import type { CaseRepository, CloseReason } from "./case-repository.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import type { ReadRefusal, ReadRequest } from "./read-request.ts";

/** At most this many past cases are listed (D17). */
export const MAXIMUM_CLOSED_CASES = 20;

export interface PastCase {
  readonly caseId: Uuid;
  readonly closedAt: Date;
  readonly closedBy: { readonly accountId: Uuid; readonly displayName: string | null };
  readonly closeReason: CloseReason;
  readonly summary: string;
}

/** The closed cases of an account, for anyone who may read it (case-lifecycle D17). */
export class ListClosedCases {
  readonly #enforcement: ReadEnforcement;
  readonly #cases: CaseRepository;
  readonly #getInternalAccountNames: GetInternalAccountNames;

  constructor(dependencies: {
    readonly enforcement: ReadEnforcement;
    readonly cases: CaseRepository;
    readonly getInternalAccountNames: GetInternalAccountNames;
  }) {
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
    this.#getInternalAccountNames = dependencies.getInternalAccountNames;
  }

  /**
   * @ensures Read through the enforcement template: one audited `account.read` decision on the account
   *          (`ListClosedCases`); refusals as any read (AU-6).
   * @ensures At most `MAXIMUM_CLOSED_CASES` closed cases of the account, newest first, with who closed each.
   */
  async execute(
    request: ReadRequest & { readonly accountId: Uuid },
  ): Promise<{ readonly kind: "Listed"; readonly cases: readonly PastCase[] } | ReadRefusal> {
    return this.#enforcement.read(request, "ListClosedCases", request.accountId, async () => {
      const closed = await this.#cases.closedCasesOf(request.accountId, MAXIMUM_CLOSED_CASES);
      const names = await this.#getInternalAccountNames.execute(closed.map((past) => past.closedBy));
      return {
        kind: "Listed",
        cases: closed.map((past) => ({
          caseId: past.caseId,
          closedAt: past.closedAt,
          closedBy: { accountId: past.closedBy, displayName: names.get(past.closedBy) ?? null },
          closeReason: past.closeReason,
          summary: past.summary,
        })),
      } as const;
    });
  }
}

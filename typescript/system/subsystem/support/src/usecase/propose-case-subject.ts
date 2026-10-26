import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type { CaseRepository } from "./case-repository.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import { type AccountContext, accountContextOf, type ReadRefusal, type ReadRequest } from "./read-request.ts";

export type ProposeCaseSubjectResult =
  | { readonly kind: "Proposed"; readonly account: AccountContext }
  | { readonly kind: "SubjectAlreadySet" }
  | ReadRefusal;

/**
 * The assistant's proposal of a case's subject (case-lifecycle D1): a read of the account, so the card shows it as
 * stored; nothing is set.
 */
export class ProposeCaseSubject {
  readonly #enforcement: ReadEnforcement;
  readonly #cases: CaseRepository;
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly enforcement: ReadEnforcement;
    readonly cases: CaseRepository;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly clock: Clock;
  }) {
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
    this.#computeEffectiveEntitlements = dependencies.computeEffectiveEntitlements;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures In a case that already has a subject: `SubjectAlreadySet`, with nothing read.
   * @ensures Otherwise read through the enforcement template (one audited `account.read`, `ProposeCaseSubject`);
   *          allowed, the account's name, plan, and covering term as stored. The case is never changed.
   */
  async execute(request: ReadRequest & { readonly accountId: Uuid }): Promise<ProposeCaseSubjectResult> {
    if (request.caseId !== null && (await this.#cases.find(request.caseId))?.subjectAccountId != null)
      return { kind: "SubjectAlreadySet" };
    return this.#enforcement.read(request, "ProposeCaseSubject", request.accountId, async () => {
      const computed = await this.#computeEffectiveEntitlements.execute({
        accountId: request.accountId,
        at: this.#clock.now(),
      });
      if (computed === null) return { kind: "NotFound" } as const;
      return { kind: "Proposed", account: accountContextOf(computed) } as const;
    });
  }
}

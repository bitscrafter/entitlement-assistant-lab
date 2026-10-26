import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuthorizationDecider } from "../../../../port/authorization-decider.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { GetCustomerAccount } from "../../../account/src/usecase/get-customer-account.ts";
import type { FindIndividualByEmail } from "../../../customer-identity/src/usecase/find-individual-by-email.ts";
import type { ComputeEffectiveEntitlements } from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";
import type {
  FindLowestPlanIncluding,
  Remedy,
} from "../../../product/src/usecase/find-lowest-plan-including.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import {
  type AccountContext,
  accountContextOf,
  type EntitlementSource,
  type ReadRefusal,
  type ReadRequest,
  type ReasonFacts,
} from "./read-request.ts";

export type { Remedy };

export type ExplanationFinding =
  | { readonly kind: "access"; readonly grantedByRoles: readonly string[] }
  | {
      readonly kind: "entitlement";
      readonly sources: readonly EntitlementSource[];
      readonly coveringTermSource: string | null;
    };

export type ExplainAccessResult =
  | {
      readonly kind: "Explained";
      readonly account: AccountContext;
      readonly outcome: "Allow" | "Deny";
      /** Why it is allowed: present for `Allow`. */
      readonly findings: readonly ExplanationFinding[];
      /** Every reason it is denied: present for `Deny`. */
      readonly reasonCodes: readonly string[];
      readonly facts: ReasonFacts;
      readonly remedy: Remedy | null;
    }
  | ReadRefusal;

/** Why a person can or cannot use a feature operation in an account (explain-access D5). */
export class ExplainAccess {
  readonly #enforcement: ReadEnforcement;
  readonly #decider: AuthorizationDecider;
  readonly #findIndividualByEmail: FindIndividualByEmail;
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;
  readonly #findLowestPlanIncluding: FindLowestPlanIncluding;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly enforcement: ReadEnforcement;
    readonly decider: AuthorizationDecider;
    readonly findIndividualByEmail: FindIndividualByEmail;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    readonly findLowestPlanIncluding: FindLowestPlanIncluding;
    readonly clock: Clock;
  }) {
    this.#enforcement = dependencies.enforcement;
    this.#decider = dependencies.decider;
    this.#findIndividualByEmail = dependencies.findIndividualByEmail;
    this.#getCustomerAccount = dependencies.getCustomerAccount;
    this.#computeEffectiveEntitlements = dependencies.computeEffectiveEntitlements;
    this.#findLowestPlanIncluding = dependencies.findLowestPlanIncluding;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Read through the enforcement template: the employee's `account.read` decision on the subject is the
   *          only audit record (AT-3); the person's evaluated decision is not their action, so it is not audited (D5).
   * @ensures The person's decision runs through the same decision chain as a real one (AU-1), for
   *          `feature.<feature_key>.<operation>` with the person's own account as principal.
   * @ensures Allowed: the access and entitlement findings. Denied: every reason, its facts, and a remedy when the
   *          feature is not included (PR-10). A person whose email names no individual answers `NotFound`.
   */
  async execute(
    request: ReadRequest & {
      readonly personEmail: string;
      readonly accountId: Uuid;
      readonly featureKey: string;
      readonly operation: string;
    },
  ): Promise<ExplainAccessResult> {
    return this.#enforcement.read(request, "ExplainAccess", request.accountId, async () => {
      const person = await this.#findIndividualByEmail.execute(request.personEmail);
      const personAccount =
        person === null ? null : await this.#getCustomerAccount.byCustomer(person.customerId);
      if (personAccount === null) return { kind: "NotFound" };
      const computed = await this.#computeEffectiveEntitlements.execute({
        accountId: request.accountId,
        at: this.#clock.now(),
      });
      if (computed === null) return { kind: "NotFound" };
      const account = accountContextOf(computed);
      const decision = await this.#decider.decide({
        principal: { kind: "Individual", accountId: personAccount.accountId },
        actionKey: `feature.${request.featureKey}.${request.operation}`,
        subjectAccountId: request.accountId,
      });
      if (decision.outcome === "Allow") {
        const findings = decision.findings.flatMap((finding): ExplanationFinding[] => {
          if (finding.source === "access")
            return [{ kind: "access", grantedByRoles: finding.grantedByRoles }];
          if (finding.source === "entitlement") {
            return [
              {
                kind: "entitlement",
                sources: finding.sources,
                coveringTermSource: finding.coveringTermSource,
              },
            ];
          }
          return [];
        });
        return {
          kind: "Explained",
          account,
          outcome: "Allow",
          findings,
          reasonCodes: [],
          facts: {},
          remedy: null,
        };
      }
      const entitlementFinding = decision.findings.find((finding) => finding.source === "entitlement");
      const facts = entitlementFinding?.source === "entitlement" ? entitlementFinding.facts : {};
      const remedy = decision.reasonCodes.includes("entitlement.feature-not-included")
        ? await this.#findLowestPlanIncluding.execute({
            featureKey: request.featureKey,
            currentPlanKey: computed.latestPlanKey,
          })
        : null;
      return {
        kind: "Explained",
        account,
        outcome: "Deny",
        findings: [],
        reasonCodes: decision.reasonCodes,
        facts,
        remedy,
      };
    });
  }
}

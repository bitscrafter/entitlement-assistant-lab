import type { DecisionRequest } from "../../../../port/authorization-decider.ts";
import type {
  CustomerAccountView,
  GetCustomerAccount,
} from "../../../account/src/usecase/get-customer-account.ts";
import type { EmployeePrincipal, LoadPrincipal } from "../../../account/src/usecase/load-principal.ts";
import type {
  AccountEntitlements,
  ComputeEffectiveEntitlements,
} from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";

/** What a principal's account says about it, loaded fresh (CM-16). */
export type PrincipalState =
  | { readonly kind: "Employee"; readonly employee: EmployeePrincipal }
  | { readonly kind: "Individual"; readonly account: CustomerAccountView }
  | { readonly kind: "MayNotAct"; readonly reasonCodes: readonly string[] };

/**
 * The Policy Information Point of one decision (AU-5): every attribute is loaded from trusted data, at most once,
 * and only when a step asks for it.
 */
export class DecisionAttributes {
  readonly request: DecisionRequest;
  readonly now: Date;
  readonly #loadPrincipal: LoadPrincipal;
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #computeEffectiveEntitlements: ComputeEffectiveEntitlements;
  #principal: Promise<PrincipalState> | undefined;
  #subject: Promise<AccountEntitlements | null> | undefined;

  constructor(
    request: DecisionRequest,
    now: Date,
    sources: {
      readonly loadPrincipal: LoadPrincipal;
      readonly getCustomerAccount: GetCustomerAccount;
      readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
    },
  ) {
    this.request = request;
    this.now = now;
    this.#loadPrincipal = sources.loadPrincipal;
    this.#getCustomerAccount = sources.getCustomerAccount;
    this.#computeEffectiveEntitlements = sources.computeEffectiveEntitlements;
  }

  /** @ensures The principal's account state; an account that does not exist rejects (sessions name real accounts). */
  principal(): Promise<PrincipalState> {
    this.#principal ??= this.#loadPrincipalState();
    return this.#principal;
  }

  /** @ensures The subject account with its effective entitlements at `now`; null without a subject or when it does not exist. */
  subject(): Promise<AccountEntitlements | null> {
    const subjectAccountId = this.request.subjectAccountId;
    this.#subject ??=
      subjectAccountId === null
        ? Promise.resolve(null)
        : this.#computeEffectiveEntitlements.execute({ accountId: subjectAccountId, at: this.now });
    return this.#subject;
  }

  async #loadPrincipalState(): Promise<PrincipalState> {
    const principal = this.request.principal;
    if (principal.kind === "Employee") {
      const loaded = await this.#loadPrincipal.execute(principal.accountId);
      if (loaded.ok) return { kind: "Employee", employee: loaded.value };
      if (loaded.failure.kind === "MayNotAct")
        return { kind: "MayNotAct", reasonCodes: loaded.failure.reasons };
      throw new Error("A decision was requested for an account that is no employee's.");
    }
    const account = await this.#getCustomerAccount.execute(principal.accountId);
    if (account === null) throw new Error("A decision was requested for an account that does not exist.");
    if (account.holdReasonCodes.length > 0)
      return { kind: "MayNotAct", reasonCodes: account.holdReasonCodes };
    return { kind: "Individual", account };
  }
}

import type { Uuid } from "../../../../kernel/identifier.ts";
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
import type { JudgeGrantChange } from "../../../entitlement/src/usecase/judge-grant-change.ts";

/** What a principal's account says about it, loaded fresh (CM-16). */
export type PrincipalState =
  | { readonly kind: "Employee"; readonly employee: EmployeePrincipal }
  | { readonly kind: "Individual"; readonly account: CustomerAccountView }
  | { readonly kind: "System"; readonly accountId: Uuid }
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
  /** The grant rules (EN-4, D5), for the entitlement and policy steps. */
  readonly judgeGrantChange: JudgeGrantChange;
  #principal: Promise<PrincipalState> | undefined;
  #subject: Promise<AccountEntitlements | null> | undefined;
  #contact: Promise<CustomerAccountView | null> | undefined;

  constructor(
    request: DecisionRequest,
    now: Date,
    sources: {
      readonly loadPrincipal: LoadPrincipal;
      readonly getCustomerAccount: GetCustomerAccount;
      readonly computeEffectiveEntitlements: ComputeEffectiveEntitlements;
      readonly judgeGrantChange: JudgeGrantChange;
    },
  ) {
    this.request = request;
    this.now = now;
    this.#loadPrincipal = sources.loadPrincipal;
    this.#getCustomerAccount = sources.getCustomerAccount;
    this.#computeEffectiveEntitlements = sources.computeEffectiveEntitlements;
    this.judgeGrantChange = sources.judgeGrantChange;
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

  /** @ensures The case's contact account, null without a contact or when it does not exist. */
  contact(): Promise<CustomerAccountView | null> {
    const contactAccountId = this.request.contactAccountId ?? null;
    this.#contact ??=
      contactAccountId === null ? Promise.resolve(null) : this.#getCustomerAccount.execute(contactAccountId);
    return this.#contact;
  }

  /**
   * `context.duration_days` of a grant change (grants-and-approvals D5): the days granted for the feature on the
   * subject within the last 90 days, the requested window included.
   *
   * @ensures null without a requested window, a feature, or a subject.
   */
  /**
   * `context.quota` of a grant change: its quota with the quota of the feature's grants overlapping its window
   * (cumulative, owner 2026-10-27).
   *
   * @ensures null without a quota, a window, a feature, or a subject.
   */
  async quotaGranted(): Promise<number | null> {
    const context = this.request.context;
    if (context?.quota === undefined || context.grantWindow === undefined || context.featureKey === undefined)
      return null;
    const subject = await this.subject();
    if (subject === null) return null;
    return this.judgeGrantChange.quotaGranted(
      subject.account.accountId,
      context.featureKey,
      context.grantWindow,
      context.quota,
      context.extendsGrantId ?? null,
    );
  }

  async daysGranted(): Promise<number | null> {
    const context = this.request.context;
    if (context?.grantWindow === undefined || context.featureKey === undefined) return null;
    const subject = await this.subject();
    if (subject === null) return null;
    return this.judgeGrantChange.daysGranted(
      subject.account.accountId,
      context.featureKey,
      context.grantWindow,
      this.now,
    );
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
    if (principal.kind === "System") {
      const loaded = await this.#loadPrincipal.system(principal.accountId);
      if (loaded.ok) return { kind: "System", accountId: loaded.value.accountId };
      if (loaded.failure.kind === "MayNotAct")
        return { kind: "MayNotAct", reasonCodes: loaded.failure.reasons };
      throw new Error("A decision was requested for an account that is no system identity's.");
    }
    const account = await this.#getCustomerAccount.execute(principal.accountId);
    if (account === null) throw new Error("A decision was requested for an account that does not exist.");
    if (account.holdReasonCodes.length > 0)
      return { kind: "MayNotAct", reasonCodes: account.holdReasonCodes };
    return { kind: "Individual", account };
  }
}

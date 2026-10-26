import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { AuthorizationDecider, Decision } from "../../../../port/authorization-decider.ts";
import type {
  CustomerAccountView,
  GetCustomerAccount,
} from "../../../account/src/usecase/get-customer-account.ts";
import { disclose } from "../model/disclosure.ts";
import type { CaseRepository, SupportCase } from "./case-repository.ts";
import { combineDecisions } from "./combined-decision.ts";

/** Who acts, and in which case: every value comes from the verified session or the route, never from the model. */
export interface CaseActionRequest {
  readonly principalAccountId: Uuid;
  readonly sessionId: Uuid | null;
  readonly traceId: string;
  readonly caseId: Uuid;
}

/** The case assignee check's refusals (case-lifecycle D9, D10): each answers as a missing case. */
export type CaseRefusal = { readonly kind: "CaseNotFound" } | { readonly kind: "CaseNotAssigned" };

/** Refusals of a case action's decision (AU-6; explain-access D4 when no account is involved). */
export type ActionRefusal =
  | { readonly kind: "NotFound" }
  | { readonly kind: "Denied"; readonly reasonCodes: readonly string[] }
  | { readonly kind: "Forbidden" };

/** What an allowed action's work did: its result, recorded as `Succeeded`, or `Failed` with its reason (D12). */
export type WorkOutcome<Result> =
  | { readonly outcome: "Succeeded"; readonly result: Result }
  | { readonly outcome: "Failed"; readonly reasonCode: string; readonly result: Result };

const READ = "account.read";

/**
 * The case assignee check (SU-14, case-lifecycle D9, D10): only the current assignee acts in a case. A closed case
 * has no assignee, so it is refused like another CSR's.
 */
export class CaseAssigneeCheck {
  readonly #cases: CaseRepository;

  constructor(dependencies: { readonly cases: CaseRepository }) {
    this.#cases = dependencies.cases;
  }

  /**
   * @ensures The case when the principal is its current assignee; otherwise why not, with nothing recorded.
   * @ensures With `lock`, the case stays locked until the caller's transaction ends, so the state an action decides
   *          on is the state it writes to: no concurrent action can close the case or change its contact in between
   *          (review R1, R2). Every action locks; reading the case does not.
   */
  async execute(
    request: Pick<CaseActionRequest, "caseId" | "principalAccountId">,
    lock: "Lock" | "Read" = "Lock",
  ): Promise<{ readonly kind: "Assigned"; readonly supportCase: SupportCase } | CaseRefusal> {
    const supportCase =
      lock === "Lock"
        ? await this.#cases.findForUpdate(request.caseId)
        : await this.#cases.find(request.caseId);
    if (supportCase === null) return { kind: "CaseNotFound" };
    if (supportCase.assigneeAccountId !== request.principalAccountId) return { kind: "CaseNotAssigned" };
    return { kind: "Assigned", supportCase };
  }
}

/**
 * The Policy Enforcement Point of every case lifecycle action (AU-5): one template, so no action can skip a step.
 * An action on an account includes `account.read` on it as a finding of its own decision (AU-4, case-lifecycle Q1).
 */
export class CaseActionEnforcement {
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;
  readonly #getCustomerAccount: GetCustomerAccount;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
    readonly getCustomerAccount: GetCustomerAccount;
  }) {
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
    this.#getCustomerAccount = dependencies.getCustomerAccount;
  }

  /**
   * @ensures Without the governing permission (or `account.read`, when an account is involved), refused before any
   *          customer data is read, with one `Deny` record (D12 of explain-access): `NotFound` with an account,
   *          `Forbidden` without.
   * @ensures An account that does not exist is `NotFound`, with no record.
   * @ensures Otherwise one record of the combined decision; a refusal is disclosed by `disclose` (AU-6), or
   *          `Forbidden` without an account; when allowed, `work` runs and its outcome is recorded (`Succeeded`, or
   *          `Failed` with its reason).
   */
  async act<Result>(
    request: CaseActionRequest,
    actionKey: string,
    accountId: Uuid | null,
    work: (account: CustomerAccountView | null, decision: Decision) => Promise<WorkOutcome<Result>>,
  ): Promise<{ readonly kind: "Acted"; readonly outcome: WorkOutcome<Result> } | ActionRefusal> {
    const principal = { kind: "Employee", accountId: request.principalAccountId } as const;
    const gate = combineDecisions(
      await this.#decider.decidePermission({ principal, actionKey }),
      ...(accountId === null ? [] : [await this.#decider.decidePermission({ principal, actionKey: READ })]),
    );
    if (gate.outcome !== "Allow") {
      await this.#record(
        request,
        actionKey,
        accountId,
        gate.outcome,
        gate.reasonCodes,
        gate.policySetVersion,
      );
      return accountId === null ? { kind: "Forbidden" } : { kind: "NotFound" };
    }
    const account = accountId === null ? null : await this.#getCustomerAccount.execute(accountId);
    if (accountId !== null && account === null) return { kind: "NotFound" };

    const decision = combineDecisions(
      await this.#decider.decide({ principal, actionKey, subjectAccountId: accountId }),
      ...(accountId === null
        ? []
        : [await this.#decider.decide({ principal, actionKey: READ, subjectAccountId: accountId })]),
    );
    await this.#record(
      request,
      actionKey,
      accountId,
      decision.outcome,
      decision.reasonCodes,
      decision.policySetVersion,
    );
    if (decision.outcome !== "Allow") {
      if (accountId === null) return { kind: "Forbidden" };
      const disclosure = disclose(decision, true);
      return disclosure.kind === "Denied" ? disclosure : { kind: "NotFound" };
    }
    const outcome = await work(account, decision);
    await this.#record(
      request,
      actionKey,
      accountId,
      outcome.outcome,
      outcome.outcome === "Failed" ? [outcome.reasonCode] : [],
      decision.policySetVersion,
    );
    return { kind: "Acted", outcome };
  }

  #record(
    request: CaseActionRequest,
    actionKey: string,
    accountId: Uuid | null,
    outcome: "Allow" | "Deny" | "Conditional" | "Succeeded" | "Failed",
    reasons: readonly string[],
    policySetVersion: string,
  ): Promise<void> {
    return this.#audit.record({
      actorAccountId: request.principalAccountId,
      sessionId: request.sessionId,
      traceId: request.traceId,
      actionKey,
      outcome,
      policySetVersion,
      subjectAccountId: accountId,
      caseId: request.caseId,
      changeRequestId: null,
      detail: {},
      participants: [],
      reasons,
    });
  }
}

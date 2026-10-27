import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type {
  AuthorizationDecider,
  Decision,
  DecisionContext,
} from "../../../../port/authorization-decider.ts";
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
export type WorkOutcome<Result> = (
  | { readonly outcome: "Succeeded"; readonly result: Result }
  | { readonly outcome: "Failed"; readonly reasonCode: string; readonly result: Result }
) & {
  /** What the outcome's record keeps beyond its reasons (an authentication's kind and method, D21). */
  readonly detail?: JsonObject;
};

const READ = "account.read";

type AuditOutcomeOf = "Allow" | "Deny" | "Conditional" | "Succeeded" | "Failed";

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
   * @ensures With `readsAccount` false (closing, D19), the account is named in the records, but `account.read` is
   *          neither gated nor decided, and a refusal is `Forbidden`.
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
    options: { readonly readsAccount: boolean; readonly changeRequestId?: Uuid } = { readsAccount: true },
  ): Promise<{ readonly kind: "Acted"; readonly outcome: WorkOutcome<Result> } | ActionRefusal> {
    const principal = { kind: "Employee", accountId: request.principalAccountId } as const;
    // The account this action reads, so decides `account.read` on: none for closing (D19), which only names it.
    const readAccountId = options.readsAccount ? accountId : null;
    const record = (
      outcome: AuditOutcomeOf,
      reasons: readonly string[],
      policySetVersion: string,
      detail: JsonObject = {},
    ) =>
      this.#record(
        request,
        actionKey,
        accountId,
        outcome,
        reasons,
        policySetVersion,
        detail,
        options.changeRequestId ?? null,
      );
    const gate = combineDecisions(
      await this.#decider.decidePermission({ principal, actionKey }),
      ...(readAccountId === null
        ? []
        : [await this.#decider.decidePermission({ principal, actionKey: READ })]),
    );
    if (gate.outcome !== "Allow") {
      await record(gate.outcome, gate.reasonCodes, gate.policySetVersion);
      return readAccountId === null ? { kind: "Forbidden" } : { kind: "NotFound" };
    }
    const account = readAccountId === null ? null : await this.#getCustomerAccount.execute(readAccountId);
    if (readAccountId !== null && account === null) return { kind: "NotFound" };

    const decision = combineDecisions(
      await this.#decider.decide({ principal, actionKey, subjectAccountId: accountId }),
      ...(readAccountId === null
        ? []
        : [await this.#decider.decide({ principal, actionKey: READ, subjectAccountId: readAccountId })]),
    );
    await record(decision.outcome, decision.reasonCodes, decision.policySetVersion);
    if (decision.outcome !== "Allow") {
      if (readAccountId === null) return { kind: "Forbidden" };
      const disclosure = disclose(decision, true);
      return disclosure.kind === "Denied" ? disclosure : { kind: "NotFound" };
    }
    const outcome = await work(account, decision);
    await record(
      outcome.outcome,
      outcome.outcome === "Failed" ? [outcome.reasonCode] : [],
      decision.policySetVersion,
      outcome.detail,
    );
    return { kind: "Acted", outcome };
  }

  /**
   * The first half of a change's enforcement (grants-and-approvals D16, D17): the permission gate, before the change
   * request or its grant is read.
   *
   * @ensures Without the change's governing permission or `account.read`, `NotFound` with one `Deny` record, before
   *          any customer data is read; an account that does not exist is `NotFound`, with no record.
   * @ensures Otherwise the subject account, for `decideChange`.
   */
  async gateChange(
    request: CaseActionRequest,
    actionKey: string,
    accountId: Uuid,
  ): Promise<{ readonly kind: "Readable"; readonly account: CustomerAccountView } | ActionRefusal> {
    const principal = { kind: "Employee", accountId: request.principalAccountId } as const;
    const gate = combineDecisions(
      await this.#decider.decidePermission({ principal, actionKey }),
      await this.#decider.decidePermission({ principal, actionKey: READ }),
    );
    if (gate.outcome !== "Allow") {
      await this.#record(
        request,
        actionKey,
        accountId,
        gate.outcome,
        gate.reasonCodes,
        gate.policySetVersion,
        {},
        null,
      );
      return { kind: "NotFound" };
    }
    const account = await this.#getCustomerAccount.execute(accountId);
    return account === null ? { kind: "NotFound" } : { kind: "Readable", account };
  }

  /**
   * A read of a change request (grants-and-approvals D17; review R1-4): decided fresh, as any read of its subject.
   *
   * @ensures `gateChange` first; then `account.read` on the subject decided and recorded, naming the request.
   * @ensures `Readable` only when it allows; otherwise refused as any read (`disclose`).
   */
  async readChange(
    request: CaseActionRequest,
    actionKey: string,
    accountId: Uuid,
    changeRequestId: Uuid,
  ): Promise<{ readonly kind: "Readable" } | ActionRefusal> {
    const gate = await this.gateChange(request, actionKey, accountId);
    if (gate.kind !== "Readable") return gate;
    const read = await this.#decider.decide({
      principal: { kind: "Employee", accountId: request.principalAccountId },
      actionKey: READ,
      subjectAccountId: accountId,
    });
    await this.#audit.record({
      actorAccountId: request.principalAccountId,
      sessionId: request.sessionId,
      traceId: request.traceId,
      actionKey: READ,
      outcome: read.outcome,
      policySetVersion: read.policySetVersion,
      subjectAccountId: accountId,
      caseId: request.caseId,
      changeRequestId,
      detail: {},
      participants: [],
      reasons: read.reasonCodes,
    });
    if (read.outcome === "Allow") return { kind: "Readable" };
    const disclosure = disclose(read, true);
    return disclosure.kind === "Denied" ? disclosure : { kind: "NotFound" };
  }

  /**
   * The second half (D2, D16, D17): the change's decision with its context and contact, combined with `account.read`.
   *
   * @ensures One record of the combined decision under `actionKey`, naming the change request and the contact.
   * @ensures A principal the read decision refuses is refused as for any read (`disclose`): the change is not decided
   *          for them.
   * @ensures `Preview`: `work` runs on any decision the principal may read the subject for (D2). `Enforce`: `work`
   *          runs on `Allow` and `Conditional`; a `Deny` is `Denied` with every reason (D17).
   * @ensures `work`'s outcome is recorded under `recordAs`, naming the change request.
   */
  async decideChange<Result>(
    request: CaseActionRequest,
    change: {
      readonly actionKey: string;
      readonly recordAs: string;
      readonly accountId: Uuid;
      readonly changeRequestId: Uuid;
      readonly contactAccountId: Uuid | null;
      readonly context: DecisionContext;
      readonly mode: "Preview" | "Enforce";
    },
    work: (decision: Decision) => Promise<WorkOutcome<Result>>,
  ): Promise<{ readonly kind: "Acted"; readonly outcome: WorkOutcome<Result> } | ActionRefusal> {
    const principal = { kind: "Employee", accountId: request.principalAccountId } as const;
    const read = await this.#decider.decide({
      principal,
      actionKey: READ,
      subjectAccountId: change.accountId,
    });
    const decision = combineDecisions(
      await this.#decider.decide({
        principal,
        actionKey: change.actionKey,
        subjectAccountId: change.accountId,
        contactAccountId: change.contactAccountId,
        context: change.context,
      }),
      read,
    );
    const participants =
      change.contactAccountId === null
        ? []
        : [{ role: "Contact" as const, accountId: change.contactAccountId }];
    const record = (
      actionKey: string,
      outcome: AuditOutcomeOf,
      reasons: readonly string[],
      detail: JsonObject = {},
    ) =>
      this.#audit.record({
        actorAccountId: request.principalAccountId,
        sessionId: request.sessionId,
        traceId: request.traceId,
        actionKey,
        outcome,
        policySetVersion: decision.policySetVersion,
        subjectAccountId: change.accountId,
        caseId: request.caseId,
        changeRequestId: change.changeRequestId,
        detail,
        participants,
        reasons,
      });
    await record(change.actionKey, decision.outcome, decision.reasonCodes);
    if (read.outcome !== "Allow") {
      const disclosure = disclose(read, true);
      return disclosure.kind === "Denied" ? disclosure : { kind: "NotFound" };
    }
    if (change.mode === "Enforce" && decision.outcome === "Deny")
      return { kind: "Denied", reasonCodes: decision.reasonCodes };
    const outcome = await work(decision);
    await record(
      change.recordAs,
      outcome.outcome,
      outcome.outcome === "Failed" ? [outcome.reasonCode] : [],
      outcome.detail,
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
    detail: JsonObject,
    changeRequestId: Uuid | null,
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
      changeRequestId,
      detail,
      participants: [],
      reasons,
    });
  }
}

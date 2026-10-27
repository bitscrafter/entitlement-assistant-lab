import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { AuthorizationDecider, Decision } from "../../../../port/authorization-decider.ts";
import type {
  CustomerAccountView,
  GetCustomerAccount,
} from "../../../account/src/usecase/get-customer-account.ts";
import { disclose } from "../model/disclosure.ts";
import type { CaseRepository } from "./case-repository.ts";
import type { ReadRefusal, ReadRequest } from "./read-request.ts";

/** The action every read of a subject account is decided as (AU-4). */
const READ = "account.read";

/**
 * The Policy Enforcement Point of every employee read of a subject account (AU-5): one template, so no read can
 * skip a step. Each decision writes exactly one audit record (AT-3).
 */
export class ReadEnforcement {
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;
  readonly #getCustomerAccount: GetCustomerAccount;
  readonly #cases: CaseRepository;

  constructor(dependencies: {
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
    readonly getCustomerAccount: GetCustomerAccount;
    readonly cases: CaseRepository;
  }) {
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
    this.#getCustomerAccount = dependencies.getCustomerAccount;
    this.#cases = dependencies.cases;
  }

  /**
   * The subject rule (case-lifecycle D6): once a case's subject is set, a read in the case is of the subject only.
   *
   * @ensures True exactly when the request is made in a case whose subject is set and is not `accountId`.
   */
  async outsideCaseSubject(request: ReadRequest, accountId: Uuid): Promise<boolean> {
    if (request.caseId === null) return false;
    const subjectAccountId = (await this.#cases.find(request.caseId))?.subjectAccountId ?? null;
    return subjectAccountId !== null && subjectAccountId !== accountId;
  }

  /**
   * Reads one subject account named by id: the permission gate, the subject, the decision, then `work`.
   *
   * @ensures A principal without `account.read` is refused before any customer data is read, with one audit record
   *          naming the requested id (D12): `NotFound`.
   * @ensures A subject that does not exist answers `NotFound`, with no audit record.
   * @ensures Otherwise exactly one audit record of the decision; `work` runs only when it allows; a refusal is
   *          disclosed by `disclose`.
   */
  async read<Result>(
    request: ReadRequest,
    useCase: string,
    subjectAccountId: Uuid,
    work: (subject: CustomerAccountView, decision: Decision) => Promise<Result>,
  ): Promise<Result | ReadRefusal> {
    if ((await this.permitted(request, useCase, { subjectAccountId })).outcome !== "Allow")
      return { kind: "NotFound" };
    const subject = await this.#getCustomerAccount.execute(subjectAccountId);
    if (subject === null) return { kind: "NotFound" };
    const decision = await this.decideRead(request, useCase, subjectAccountId);
    const disclosure = disclose(decision, true);
    if (disclosure.kind !== "Allowed") return disclosure;
    return work(subject, decision);
  }

  /**
   * The permission gate (D12): whether the principal holds `account.read` at all.
   *
   * @ensures The gate's decision: `Allow` exactly when the principal holds `account.read`.
   * @ensures When it does not, one `Deny` audit record is written, naming the requested subject or, for a lookup,
   *          the query's keyed hash.
   */
  async permitted(
    request: ReadRequest,
    useCase: string,
    target: { readonly subjectAccountId: Uuid } | { readonly queryHash: string },
  ): Promise<Decision> {
    const gate = await this.#decider.decidePermission({
      principal: { kind: "Employee", accountId: request.principalAccountId },
      actionKey: READ,
    });
    if (gate.outcome !== "Allow") {
      await this.record(request, gate, {
        subjectAccountId: "subjectAccountId" in target ? target.subjectAccountId : null,
        detail:
          "queryHash" in target ? { use_case: useCase, query_hmac: target.queryHash } : { use_case: useCase },
      });
    }
    return gate;
  }

  /** @ensures The decision on reading the subject, recorded in exactly one audit record. */
  async decideRead(request: ReadRequest, useCase: string, subjectAccountId: Uuid): Promise<Decision> {
    const decision = await this.#decider.decide({
      principal: { kind: "Employee", accountId: request.principalAccountId },
      actionKey: READ,
      subjectAccountId,
    });
    await this.record(request, decision, { subjectAccountId, detail: { use_case: useCase } });
    return decision;
  }

  /** @ensures One `account.read` audit record of the outcome, in the caller's unit of work (rule audit-fails-closed). */
  async record(
    request: ReadRequest,
    outcome: {
      readonly outcome: "Allow" | "Deny" | "Conditional" | "Failed";
      readonly reasonCodes: readonly string[];
      readonly policySetVersion: string;
    },
    target: { readonly subjectAccountId: Uuid | null; readonly detail: JsonObject },
  ): Promise<void> {
    await this.#audit.record({
      actorAccountId: request.principalAccountId,
      sessionId: request.sessionId,
      traceId: request.traceId,
      actionKey: READ,
      outcome: outcome.outcome,
      policySetVersion: outcome.policySetVersion,
      subjectAccountId: target.subjectAccountId,
      caseId: request.caseId,
      changeRequestId: null,
      detail:
        request.toolCallId === null ? target.detail : { ...target.detail, tool_call_id: request.toolCallId },
      participants: [],
      reasons: outcome.reasonCodes,
    });
  }
}

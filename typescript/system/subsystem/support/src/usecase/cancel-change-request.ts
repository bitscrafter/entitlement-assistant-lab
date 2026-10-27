import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { TransactionalOutbox } from "../../../../port/transactional-outbox.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { ChangeRequest, ChangeRequestRepository } from "./change-request-repository.ts";
import { APPROVAL_PROCESS_DESTINATION, changeRequestOfCase } from "./confirm-change-request.ts";
import { changeDetail } from "./prepare-change-request.ts";

export type CancelChangeRequestResult =
  | { readonly kind: "Canceled" }
  | { readonly kind: "ChangeRequestNotFound" }
  | { readonly kind: "NotAwaitingConfirmation" }
  | CaseRefusal
  | ActionRefusal;

/**
 * Ends what is pending of a change request (D14): one awaiting confirmation is canceled; one awaiting approval is
 * canceled with its approval, and its approval process is told to stop through the outbox.
 *
 * @returns The outbox messages written, to deliver after commit; null when the request was no longer pending.
 */
export async function cancelPending(
  changeRequests: ChangeRequestRepository,
  outbox: TransactionalOutbox,
  ids: IdGenerator,
  at: Date,
  changeRequest: ChangeRequest,
): Promise<readonly Uuid[] | null> {
  if (changeRequest.status === "AwaitingConfirmation") {
    const ended = await changeRequests.end(
      changeRequest.changeRequestId,
      ["AwaitingConfirmation"],
      "Canceled",
      null,
    );
    return ended ? [] : null;
  }
  if (changeRequest.status !== "AwaitingApproval") return null;
  const approval = await changeRequests.approvalOf(changeRequest.changeRequestId);
  // A supervisor's approval stands: the approval process applies it, even after the case closes (review R2-2).
  if (approval !== null && approval.status === "Approved") return null;
  if (!(await changeRequests.end(changeRequest.changeRequestId, ["AwaitingApproval"], "Canceled", null)))
    return null;
  if (approval === null || !(await changeRequests.endApproval(approval.approvalId, "Canceled"))) return [];
  const messageId = ids.newId();
  await outbox.add({
    messageId,
    destination: APPROVAL_PROCESS_DESTINATION,
    messageType: "terminate",
    aggregateId: approval.approvalId,
    payload: {},
    createdAt: at,
  });
  return [messageId];
}

/** The CSR cancels a prepared change request (SU-4, grants-and-approvals D1). */
export class CancelChangeRequest {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #outbox: TransactionalOutbox;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly changeRequests: ChangeRequestRepository;
    readonly outbox: TransactionalOutbox;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#changeRequests = dependencies.changeRequests;
    this.#outbox = dependencies.outbox;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Only the case's current assignee, on a request of the case (`ChangeRequestNotFound` otherwise);
   *          `change-request.cancel` decided as handling the case, without reading the account.
   * @ensures A request awaiting confirmation ends `Canceled`; one already canceled answers `Canceled` again; any
   *          other is `NotAwaitingConfirmation`, unchanged.
   */
  async execute(
    request: CaseActionRequest & { readonly changeRequestId: Uuid },
  ): Promise<CancelChangeRequestResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const changeRequest = await changeRequestOfCase(
      this.#changeRequests,
      request.changeRequestId,
      request.caseId,
    );
    if (changeRequest === null) return { kind: "ChangeRequestNotFound" };
    const acted = await this.#enforcement.act<CancelChangeRequestResult>(
      request,
      "change-request.cancel",
      changeRequest.subjectAccountId,
      async () => {
        if (changeRequest.status === "Canceled" && changeRequest.confirmedAt === null)
          return { outcome: "Succeeded", result: { kind: "Canceled" } };
        if (changeRequest.status !== "AwaitingConfirmation") {
          return {
            outcome: "Failed",
            reasonCode: "support.change-request-not-awaiting-confirmation",
            result: { kind: "NotAwaitingConfirmation" },
          };
        }
        await cancelPending(this.#changeRequests, this.#outbox, this.#ids, this.#clock.now(), changeRequest);
        return {
          outcome: "Succeeded",
          result: { kind: "Canceled" },
          detail: changeDetail(changeRequest.change, null),
        };
      },
      { readsAccount: false, changeRequestId: changeRequest.changeRequestId },
    );
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

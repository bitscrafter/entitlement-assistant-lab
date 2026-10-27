import type { Uuid } from "../../../../kernel/identifier.ts";
import type { ApprovalStatus } from "../model/change-request.ts";
import { actionKeyOf } from "../model/change-request.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { ChangeRequest, ChangeRequestRepository } from "./change-request-repository.ts";

export type GetChangeRequestResult =
  | {
      readonly kind: "Found";
      readonly changeRequest: ChangeRequest;
      readonly approval: {
        readonly approvalId: Uuid;
        readonly status: ApprovalStatus;
        readonly expiresAt: Date;
      } | null;
    }
  | { readonly kind: "ChangeRequestNotFound" }
  | CaseRefusal
  | ActionRefusal;

/** A change request of the case, as the change request card re-reads it after a click (grants-and-approvals D1). */
export class GetChangeRequest {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #changeRequests: ChangeRequestRepository;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly changeRequests: ChangeRequestRepository;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#changeRequests = dependencies.changeRequests;
  }

  /**
   * @ensures Only the case's current assignee, on a request of the case, decided fresh as a read of its subject
   *          (`readChange`, review R1-4): a CSR who may no longer read the subject is refused as for any read.
   */
  async execute(
    request: CaseActionRequest & { readonly changeRequestId: Uuid },
  ): Promise<GetChangeRequestResult> {
    const assigned = await this.#check.execute(request, "Read");
    if (assigned.kind !== "Assigned") return assigned;
    const changeRequest = await this.#changeRequests.find(request.changeRequestId, "Read");
    if (changeRequest === null || changeRequest.caseId !== request.caseId)
      return { kind: "ChangeRequestNotFound" };
    const read = await this.#enforcement.readChange(
      request,
      actionKeyOf(changeRequest.change.kind),
      changeRequest.subjectAccountId,
      changeRequest.changeRequestId,
    );
    if (read.kind !== "Readable") return read;
    const approval = await this.#changeRequests.approvalOf(changeRequest.changeRequestId);
    return {
      kind: "Found",
      changeRequest,
      approval:
        approval === null
          ? null
          : { approvalId: approval.approvalId, status: approval.status, expiresAt: approval.expiresAt },
    };
  }
}

import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { TransactionalOutbox } from "../../../../port/transactional-outbox.ts";
import type { GetGrant, StoredGrant } from "../../../entitlement/src/usecase/grant-changes.ts";
import { actionKeyOf } from "../model/change-request.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { ChangeApplication } from "./change-application.ts";
import type { ChangeRequest, ChangeRequestRepository } from "./change-request-repository.ts";
import { changeContextOf, changeDetail, contactOf } from "./prepare-change-request.ts";

/** Where approval messages go (D6). */
export const APPROVAL_PROCESS_DESTINATION = "approval-process";

/** The confirmation's answer, given again to every later confirmation (D4). */
export type ConfirmationResponse =
  | { readonly status: "Applied" }
  | { readonly status: "AwaitingApproval"; readonly approvalId: Uuid };

export type ConfirmChangeRequestResult =
  | {
      readonly kind: "Confirmed";
      readonly response: ConfirmationResponse;
      readonly outboxMessageIds: readonly Uuid[];
    }
  | { readonly kind: "ChangeRequestNotFound" }
  | { readonly kind: "NotAwaitingConfirmation" }
  | { readonly kind: "Stale" }
  | CaseRefusal
  | ActionRefusal;

export function responseJson(response: ConfirmationResponse): JsonObject {
  return response.status === "Applied"
    ? { status: "Applied" }
    : { status: "AwaitingApproval", approval_id: response.approvalId };
}

function responseOf(json: JsonObject): ConfirmationResponse {
  return json.status === "AwaitingApproval"
    ? { status: "AwaitingApproval", approvalId: String(json.approval_id) as Uuid }
    : { status: "Applied" };
}

/** The change request of a case, read for an action on it: one of another case is not found. */
export async function changeRequestOfCase(
  changeRequests: ChangeRequestRepository,
  changeRequestId: Uuid,
  caseId: Uuid,
): Promise<ChangeRequest | null> {
  const found = await changeRequests.find(changeRequestId, "Lock");
  return found !== null && found.caseId === caseId ? found : null;
}

/** The CSR confirms a prepared change (SU-4, SU-5, grants-and-approvals D2, D4, D6). */
export class ConfirmChangeRequest {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #application: ChangeApplication;
  readonly #getGrant: GetGrant;
  readonly #outbox: TransactionalOutbox;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #approvalWindowMilliseconds: number;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly changeRequests: ChangeRequestRepository;
    readonly application: ChangeApplication;
    readonly getGrant: GetGrant;
    readonly outbox: TransactionalOutbox;
    readonly ids: IdGenerator;
    readonly clock: Clock;
    readonly approvalWindowMilliseconds: number;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#changeRequests = dependencies.changeRequests;
    this.#application = dependencies.application;
    this.#getGrant = dependencies.getGrant;
    this.#outbox = dependencies.outbox;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#approvalWindowMilliseconds = dependencies.approvalWindowMilliseconds;
  }

  /**
   * @ensures Only the case's current assignee, on a request of the case (`ChangeRequestNotFound` otherwise), after the
   *          permission gate; the case and the request stay locked, so two confirmations run one after the other.
   * @ensures A request already confirmed answers its first confirmation's response, and nothing is decided or
   *          written again (D4); one canceled, refused, or expired before confirmation is `NotAwaitingConfirmation`.
   * @ensures Otherwise the decision now, with the request's contact and their authentication now: `Deny` is
   *          `Denied` with every reason (D17), the request still awaiting confirmation. `Allow` applies the change
   *          (`ChangeApplication.apply`; `Stale` when it no longer applies). `Conditional` makes the request
   *          `AwaitingApproval` with a `Pending` approval and an outbox message to start its process, together.
   * @ensures The contact's authentication at confirmation is kept on the request (D8).
   */
  async execute(
    request: CaseActionRequest & { readonly changeRequestId: Uuid },
  ): Promise<ConfirmChangeRequestResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const changeRequest = await changeRequestOfCase(
      this.#changeRequests,
      request.changeRequestId,
      request.caseId,
    );
    if (changeRequest === null) return { kind: "ChangeRequestNotFound" };
    const actionKey = actionKeyOf(changeRequest.change.kind);
    const gate = await this.#enforcement.gateChange(request, actionKey, changeRequest.subjectAccountId);
    if (gate.kind !== "Readable") return gate;
    if (changeRequest.status !== "AwaitingConfirmation") {
      return changeRequest.confirmationResponse === null
        ? { kind: "NotAwaitingConfirmation" }
        : {
            kind: "Confirmed",
            response: responseOf(changeRequest.confirmationResponse),
            outboxMessageIds: [],
          };
    }

    const at = this.#clock.now();
    const supportCase = assigned.supportCase;
    // The request's contact counts only while they are still the case's contact.
    const authenticatedAt =
      supportCase.contactAccountId === changeRequest.contactAccountId
        ? contactOf(supportCase).authenticatedAt
        : null;
    const grant: StoredGrant | null =
      changeRequest.change.kind === "CreateGrant"
        ? null
        : await this.#getGrant.execute(changeRequest.change.grantId);
    const acted = await this.#enforcement.decideChange<ConfirmChangeRequestResult>(
      request,
      {
        actionKey,
        recordAs: "change-request.confirm",
        accountId: changeRequest.subjectAccountId,
        changeRequestId: changeRequest.changeRequestId,
        contactAccountId: changeRequest.contactAccountId,
        context: changeContextOf(changeRequest.change, grant, at, authenticatedAt),
        mode: "Enforce",
      },
      async (decision) => {
        const detail = changeDetail(changeRequest.change, grant);
        const confirmation = (response: ConfirmationResponse) =>
          this.#changeRequests.recordConfirmation(changeRequest.changeRequestId, {
            by: request.principalAccountId,
            at,
            contactAuthenticatedAt: changeRequest.contactAccountId === null ? null : authenticatedAt,
            response: responseJson(response),
            status: response.status,
          });
        if (decision.outcome === "Allow") {
          const applied = await this.#application.apply(changeRequest, request.principalAccountId);
          if (applied.kind === "Stale") {
            return {
              outcome: "Failed",
              reasonCode: "support.stale-change-request",
              result: { kind: "Stale" },
              detail,
            };
          }
          await confirmation({ status: "Applied" });
          return {
            outcome: "Succeeded",
            result: { kind: "Confirmed", response: { status: "Applied" }, outboxMessageIds: [] },
            detail: {
              ...detail,
              status: "Applied",
              ...(applied.expiresAt === null ? {} : { expires_at: applied.expiresAt.toISOString() }),
            },
          };
        }
        const approvalId = this.#ids.newId();
        const expiresAt = new Date(at.getTime() + this.#approvalWindowMilliseconds);
        await this.#changeRequests.insertApproval({
          approvalId,
          changeRequestId: changeRequest.changeRequestId,
          requestedAt: at,
          expiresAt,
        });
        const messageId = this.#ids.newId();
        await this.#outbox.add({
          messageId,
          destination: APPROVAL_PROCESS_DESTINATION,
          messageType: "start",
          aggregateId: approvalId,
          payload: { expires_at: expiresAt.toISOString() },
          createdAt: at,
        });
        const response = { status: "AwaitingApproval", approvalId } as const;
        await confirmation(response);
        return {
          outcome: "Succeeded",
          result: { kind: "Confirmed", response, outboxMessageIds: [messageId] },
          detail: { ...detail, status: "AwaitingApproval" },
        };
      },
    );
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

import type { Uuid } from "../../../../kernel/identifier.ts";
import type { DecisionContext } from "../../../../port/authorization-decider.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { DiffOperation } from "../../../entitlement/src/usecase/entitlement-diffs.ts";
import { type GetGrant, isActive, type StoredGrant } from "../../../entitlement/src/usecase/grant-changes.ts";
import type { GetCatalog } from "../../../product/src/usecase/get-catalog.ts";
import { actionKeyOf, type ChangeAsked, grantWindowOf } from "../model/change-request.ts";
import { authenticationExpiresAt } from "../model/contact-authentication.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { SupportCase } from "./case-repository.ts";
import type { ChangeApplication } from "./change-application.ts";
import type { ChangeRequestRepository } from "./change-request-repository.ts";

/** A prepared change request as the tools and the card show it (grants-and-approvals D1, D2). */
export interface PreparedChangeRequest {
  readonly changeRequestId: Uuid;
  readonly kind: ChangeAsked["kind"];
  readonly status: "AwaitingConfirmation";
  readonly change: ChangeAsked;
  readonly diff: readonly DiffOperation[];
  readonly preview: {
    readonly outcome: "Allow" | "Deny" | "Conditional";
    readonly reasonCodes: readonly string[];
  };
}

export type PrepareChangeRequestResult =
  | { readonly kind: "Prepared"; readonly changeRequest: PreparedChangeRequest }
  | { readonly kind: "SubjectNotSet" }
  | { readonly kind: "UnknownFeature" }
  | { readonly kind: "GrantNotFound" }
  | { readonly kind: "GrantNotActive" }
  | { readonly kind: "GrantExpired" }
  | CaseRefusal
  | ActionRefusal;

/**
 * The decision context of a change: what it asks, its window, and whether the contact is authenticated as of `at`
 * (grants-and-approvals D3, D5, D13).
 */
export function changeContextOf(
  change: ChangeAsked,
  grant: StoredGrant | null,
  at: Date,
  contactAuthenticatedAt: Date | null,
): DecisionContext {
  const window = grantWindowOf(change, at, grant?.expiresAt ?? null);
  const featureKey = change.kind === "CreateGrant" ? change.featureKey : grant?.featureKey;
  const quota = change.kind === "CreateGrant" ? change.quota : (grant?.quota ?? undefined);
  return {
    ...(featureKey === undefined ? {} : { featureKey }),
    ...(quota === undefined ? {} : { quota }),
    ...(window === null ? {} : { grantWindow: window }),
    ...(change.kind === "ExtendGrant" ? { extendsGrantId: change.grantId } : {}),
    contactAuthenticated:
      contactAuthenticatedAt !== null && at < authenticationExpiresAt(contactAuthenticatedAt),
  };
}

/** The case's contact and when they authenticated, if they did. */
export function contactOf(supportCase: SupportCase): {
  readonly contactAccountId: Uuid | null;
  readonly authenticatedAt: Date | null;
} {
  return {
    contactAccountId: supportCase.contactAccountId,
    authenticatedAt: supportCase.contactAuthentication?.authenticatedAt ?? null,
  };
}

/**
 * Prepares a change on the case's subject (SU-3, grants-and-approvals D1, D2): the assistant's tools call it; it
 * changes nothing but the stored request.
 */
export class PrepareChangeRequest {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #application: ChangeApplication;
  readonly #getGrant: GetGrant;
  readonly #getCatalog: GetCatalog;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly changeRequests: ChangeRequestRepository;
    readonly application: ChangeApplication;
    readonly getGrant: GetGrant;
    readonly getCatalog: GetCatalog;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#changeRequests = dependencies.changeRequests;
    this.#application = dependencies.application;
    this.#getGrant = dependencies.getGrant;
    this.#getCatalog = dependencies.getCatalog;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures Only the case's current assignee, on the case's subject; `SubjectNotSet` without one.
   * @ensures The permission gate first (`gateChange`): nothing about the grant or the catalog is read before it.
   * @ensures A revocation or extension names a grant of the subject (`GrantNotFound` otherwise); a revocation needs it
   *          active (`GrantNotActive`); an extension needs it not expired (`GrantExpired`) and not ended otherwise
   *          (`GrantNotActive`) (D12, D13). A new grant names a catalog feature (`UnknownFeature`).
   * @ensures Otherwise the preview decision (D2): with the case's contact and their authentication now. A principal
   *          who may read the subject gets the request stored `AwaitingConfirmation` whatever the preview, with the
   *          subject's version and the entitlement diff; one who may not is refused as for a read.
   */
  async execute(
    request: CaseActionRequest & { readonly toolCallId: string | null; readonly change: ChangeAsked },
  ): Promise<PrepareChangeRequestResult> {
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const supportCase = assigned.supportCase;
    const subjectAccountId = supportCase.subjectAccountId;
    if (subjectAccountId === null) return { kind: "SubjectNotSet" };
    const change = request.change;
    const actionKey = actionKeyOf(change.kind);
    const gate = await this.#enforcement.gateChange(request, actionKey, subjectAccountId);
    if (gate.kind !== "Readable") return gate;

    const at = this.#clock.now();
    let grant: StoredGrant | null = null;
    if (change.kind === "CreateGrant") {
      const catalog = await this.#getCatalog.execute();
      if (!catalog.features.some((feature) => feature.featureKey === change.featureKey))
        return { kind: "UnknownFeature" };
    } else {
      grant = await this.#getGrant.execute(change.grantId);
      if (grant === null || grant.accountId !== subjectAccountId) return { kind: "GrantNotFound" };
      const expired = grant.endReason === "Expired" || (grant.endedAt === null && at >= grant.expiresAt);
      if (change.kind === "ExtendGrant" && expired) return { kind: "GrantExpired" };
      if (!isActive(grant, at)) return { kind: "GrantNotActive" };
    }

    const changeRequestId = this.#ids.newId();
    const contact = contactOf(supportCase);
    const acted = await this.#enforcement.decideChange<PreparedChangeRequest>(
      request,
      {
        actionKey,
        recordAs: "change-request.prepare",
        accountId: subjectAccountId,
        changeRequestId,
        contactAccountId: contact.contactAccountId,
        context: changeContextOf(change, grant, at, contact.authenticatedAt),
        mode: "Preview",
      },
      async (decision) => {
        const diff = await this.#application.diffOf(subjectAccountId, change, grant);
        const preview = { outcome: decision.outcome, reasonCodes: decision.reasonCodes };
        await this.#changeRequests.insert({
          changeRequestId,
          caseId: request.caseId,
          subjectAccountId,
          change,
          diff,
          subjectAccountVersion: gate.account.version,
          previewOutcome: preview.outcome,
          previewReasonCodes: preview.reasonCodes,
          contactAccountId: contact.contactAccountId,
          requestedBy: request.principalAccountId,
          requestedAt: at,
        });
        return {
          outcome: "Succeeded",
          result: {
            changeRequestId,
            kind: change.kind,
            status: "AwaitingConfirmation",
            change,
            diff,
            preview,
          },
          detail: changeDetail(change, grant),
        };
      },
    );
    return acted.kind === "Acted" ? { kind: "Prepared", changeRequest: acted.outcome.result } : acted;
  }
}

/** What a change's records keep for its case events (D15): the change's kind, feature, and days; no free text. */
export function changeDetail(change: ChangeAsked, grant: StoredGrant | null) {
  const featureKey = change.kind === "CreateGrant" ? change.featureKey : (grant?.featureKey ?? null);
  return {
    change_kind: change.kind,
    ...(featureKey === null ? {} : { feature_key: featureKey }),
    ...(change.kind === "RevokeGrant" ? {} : { duration_days: change.durationDays }),
    ...(change.kind === "CreateGrant" && change.quota !== undefined ? { quota: change.quota } : {}),
  };
}

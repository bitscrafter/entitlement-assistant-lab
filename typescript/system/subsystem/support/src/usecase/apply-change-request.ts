import type { Uuid } from "../../../../kernel/identifier.ts";
import type { Clock } from "../../../../port/clock.ts";
import type { IdGenerator } from "../../../../port/id-generator.ts";
import type { AccountVersions } from "../../../account/src/usecase/account-versions.ts";
import type { EntitlementDiffs } from "../../../entitlement/src/usecase/entitlement-diffs.ts";
import type { ChangeGrants, GetGrant } from "../../../entitlement/src/usecase/grant-changes.ts";
import { daysAfter } from "../model/change-request.ts";
import type { ChangeRequest, ChangeRequestRepository } from "./change-request-repository.ts";

/** What applying a change request did (D8, D12, D13). */
export type AppliedChange =
  | { readonly kind: "Applied"; readonly createdGrantId: Uuid | null; readonly expiresAt: Date | null }
  | { readonly kind: "Stale" };

/**
 * Applies a change request (SU-4, SU-15): the version and diff checks, then the grant change. The shared last step of
 * confirming (`ConfirmChangeRequest`) and of the approval process (`ApplyApprovedChange`): it decides nothing, and
 * is called only once their decision allows.
 */
export class ApplyChangeRequest {
  readonly #diffs: EntitlementDiffs;
  readonly #getGrant: GetGrant;
  readonly #changeGrants: ChangeGrants;
  readonly #accountVersions: AccountVersions;
  readonly #changeRequests: ChangeRequestRepository;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly diffs: EntitlementDiffs;
    readonly getGrant: GetGrant;
    readonly changeGrants: ChangeGrants;
    readonly accountVersions: AccountVersions;
    readonly changeRequests: ChangeRequestRepository;
    readonly ids: IdGenerator;
    readonly clock: Clock;
  }) {
    this.#diffs = dependencies.diffs;
    this.#getGrant = dependencies.getGrant;
    this.#changeGrants = dependencies.changeGrants;
    this.#accountVersions = dependencies.accountVersions;
    this.#changeRequests = dependencies.changeRequests;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
  }

  /**
   * Applies a change request in the caller's transaction (D8): the subject is locked, then its version and the
   * diff's `test` operations are checked against now.
   *
   * @ensures `Stale` when the subject's version moved, a `test` no longer holds, or the grant is no longer active; the
   *          request then ends `Canceled` (`support.stale-change-request`) and nothing else is written.
   * @ensures Otherwise the grant change made at now, the subject's version advanced, and the request `Applied` by
   *          `by`, with the grant it created.
   */
  async execute(request: ChangeRequest, by: Uuid): Promise<AppliedChange> {
    const at = this.#clock.now();
    const version = await this.#accountVersions.locked(request.subjectAccountId);
    if (
      version !== request.subjectAccountVersion ||
      !(await this.#diffs.holds(request.subjectAccountId, at, request.diff))
    ) {
      return this.#stale(request);
    }
    const change = request.change;
    let createdGrantId: Uuid | null = null;
    let expiresAt: Date | null = null;
    switch (change.kind) {
      case "CreateGrant": {
        createdGrantId = this.#ids.newId();
        expiresAt = daysAfter(at, change.durationDays);
        const created = await this.#changeGrants.create({
          grantId: createdGrantId,
          accountId: request.subjectAccountId,
          featureKey: change.featureKey,
          quota: change.quota ?? null,
          reason: change.reason,
          grantedBy: by,
          startsAt: at,
          expiresAt,
        });
        if (created !== "Created") return this.#stale(request);
        break;
      }
      case "RevokeGrant":
        if ((await this.#changeGrants.revoke({ grantId: change.grantId, at, by })) !== "Revoked")
          return this.#stale(request);
        break;
      case "ExtendGrant": {
        const grant = await this.#getGrant.execute(change.grantId);
        if (grant === null) return this.#stale(request);
        createdGrantId = this.#ids.newId();
        expiresAt = daysAfter(grant.expiresAt, change.durationDays);
        const extended = await this.#changeGrants.extend({
          grantId: change.grantId,
          newGrantId: createdGrantId,
          at,
          by,
          expiresAt,
          reason: change.reason,
        });
        if (extended !== "Extended") return this.#stale(request);
        break;
      }
    }
    await this.#accountVersions.advance(request.subjectAccountId);
    await this.#changeRequests.recordApplied(request.changeRequestId, { by, at, createdGrantId });
    return { kind: "Applied", createdGrantId, expiresAt };
  }

  async #stale(request: ChangeRequest): Promise<AppliedChange> {
    await this.#changeRequests.end(
      request.changeRequestId,
      ["AwaitingConfirmation", "AwaitingApproval"],
      "Canceled",
      "support.stale-change-request",
    );
    return { kind: "Stale" };
  }
}

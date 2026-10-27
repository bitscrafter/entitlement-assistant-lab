import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuditRecorder } from "../../../../port/audit-recorder.ts";
import type { AuthorizationDecider } from "../../../../port/authorization-decider.ts";
import type { GrantRepository, StoredGrant } from "./grant-repository.ts";

export type { StoredGrant };

/** A grant, with the account it belongs to. Internal: Support reads it to prepare a revocation or extension. */
export class GetGrant {
  readonly #grants: GrantRepository;

  constructor(dependencies: { readonly grants: GrantRepository }) {
    this.#grants = dependencies.grants;
  }

  /** @ensures The grant, or null. */
  execute(grantId: Uuid): Promise<StoredGrant | null> {
    return this.#grants.find(grantId);
  }

  /**
   * The grant an extension chain ends in (D13: a chain has at most one active grant).
   *
   * @ensures The last grant extending this one, through every extension; the grant itself when none extends it.
   */
  async latestOf(grant: StoredGrant): Promise<StoredGrant> {
    let latest = grant;
    // A chain is short; the bound only guards against a cycle that the unique index already rules out.
    for (let step = 0; step < 100; step += 1) {
      const next = await this.#grants.extensionOf(latest.grantId);
      if (next === null) return latest;
      latest = next;
    }
    return latest;
  }
}

/**
 * The grant changes (grants-and-approvals D1, D12, D13). Internal: Support's change requests call them once their
 * decision allows; they decide nothing themselves.
 */
export class ChangeGrants {
  readonly #grants: GrantRepository;

  constructor(dependencies: { readonly grants: GrantRepository }) {
    this.#grants = dependencies.grants;
  }

  /**
   * @ensures The grant stored on the account's subscription in force at `startsAt`; `NoSubscription` without one,
   *          with nothing written (EN-4).
   */
  async create(grant: {
    readonly grantId: Uuid;
    readonly accountId: Uuid;
    readonly featureKey: string;
    readonly quota: number | null;
    readonly reason: string;
    readonly grantedBy: Uuid;
    readonly startsAt: Date;
    readonly expiresAt: Date;
  }): Promise<"Created" | "NoSubscription"> {
    const subscriptionId = await this.#grants.subscriptionInForce(grant.accountId, grant.startsAt);
    if (subscriptionId === null) return "NoSubscription";
    await this.#grants.insert({ ...grant, subscriptionId, extendsGrantId: null });
    return "Created";
  }

  /** @ensures An active grant ends at `at`, `Revoked` (D12); `GrantNotActive` for one ended or expired. */
  async revoke(request: {
    readonly grantId: Uuid;
    readonly at: Date;
    readonly by: Uuid;
  }): Promise<"Revoked" | "GrantNotActive"> {
    const grant = await this.#grants.find(request.grantId);
    if (grant === null || !isActive(grant, request.at)) return "GrantNotActive";
    const ended = await this.#grants.end(request.grantId, {
      at: request.at,
      by: request.by,
      reason: "Revoked",
    });
    return ended ? "Revoked" : "GrantNotActive";
  }

  /**
   * @ensures An active grant ends at `at`, `Extended`, and a grant of the same feature and quota, linked to it, runs
   *          from `at` to `expiresAt` (D13); no row's dates are edited.
   * @ensures `GrantNotActive` for a grant ended or expired; `NoSubscription` when the account has none in force.
   */
  async extend(request: {
    readonly grantId: Uuid;
    readonly newGrantId: Uuid;
    readonly at: Date;
    readonly by: Uuid;
    readonly expiresAt: Date;
    readonly reason: string;
  }): Promise<"Extended" | "GrantNotActive" | "NoSubscription"> {
    const grant = await this.#grants.find(request.grantId);
    if (grant === null || !isActive(grant, request.at)) return "GrantNotActive";
    const subscriptionId = await this.#grants.subscriptionInForce(grant.accountId, request.at);
    if (subscriptionId === null) return "NoSubscription";
    if (!(await this.#grants.end(grant.grantId, { at: request.at, by: request.by, reason: "Extended" })))
      return "GrantNotActive";
    await this.#grants.insert({
      grantId: request.newGrantId,
      subscriptionId,
      featureKey: grant.featureKey,
      quota: grant.quota,
      reason: request.reason,
      grantedBy: request.by,
      startsAt: request.at,
      expiresAt: request.expiresAt,
      extendsGrantId: grant.grantId,
    });
    return "Extended";
  }
}

/** @ensures Whether the grant grants at `at`: started, not ended, not expired (EN-5). */
export function isActive(grant: StoredGrant, at: Date): boolean {
  return grant.startsAt <= at && grant.endedAt === null && at < grant.expiresAt;
}

/** How many expired grants one sweep records at most; the next sweep records the rest. */
const EXPIRIES_PER_SWEEP = 200;

/**
 * Records the end of grants that expired (grants-and-approvals D10): access already ended at the expiry (EN-5); this
 * keeps the record. Run by the scheduled sweep as `sys_grant_expiry`.
 */
export class RecordGrantExpiries {
  readonly #grants: GrantRepository;
  readonly #decider: AuthorizationDecider;
  readonly #audit: AuditRecorder;

  constructor(dependencies: {
    readonly grants: GrantRepository;
    readonly decider: AuthorizationDecider;
    readonly audit: AuditRecorder;
  }) {
    this.#grants = dependencies.grants;
    this.#decider = dependencies.decider;
    this.#audit = dependencies.audit;
  }

  /**
   * @ensures Nothing when no grant expired; otherwise one record of the system identity's decision on
   *          `grant.record-expiry`, and only when it allows: each grant expired at `at` and not ended is ended at its
   *          expiry, `Expired`, by the system identity, with one `Succeeded` record naming its account.
   * @returns How many grants were recorded expired.
   */
  async execute(request: {
    readonly systemAccountId: Uuid;
    readonly at: Date;
    readonly traceId: string;
  }): Promise<number> {
    const expired = await this.#grants.expiredNotEnded(request.at, EXPIRIES_PER_SWEEP);
    if (expired.length === 0) return 0;
    const actionKey = "grant.record-expiry";
    const decision = await this.#decider.decide({
      principal: { kind: "System", accountId: request.systemAccountId },
      actionKey,
      subjectAccountId: null,
    });
    const record = (
      outcome: "Allow" | "Deny" | "Conditional" | "Succeeded",
      subjectAccountId: Uuid | null,
      reasons: readonly string[],
    ) =>
      this.#audit.record({
        actorAccountId: request.systemAccountId,
        sessionId: null,
        traceId: request.traceId,
        actionKey,
        outcome,
        policySetVersion: decision.policySetVersion,
        subjectAccountId,
        caseId: null,
        changeRequestId: null,
        detail: {},
        participants: [],
        reasons,
      });
    await record(decision.outcome, null, decision.reasonCodes);
    if (decision.outcome !== "Allow") return 0;
    let recorded = 0;
    for (const grant of expired) {
      const ended = await this.#grants.end(grant.grantId, {
        at: grant.expiresAt,
        by: request.systemAccountId,
        reason: "Expired",
      });
      if (!ended) continue;
      await record("Succeeded", grant.accountId, []);
      recorded += 1;
    }
    return recorded;
  }
}

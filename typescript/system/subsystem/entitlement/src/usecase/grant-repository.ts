import type { Uuid } from "../../../../kernel/identifier.ts";

export type GrantEndReason = "Revoked" | "Expired" | "SubscriptionEnded" | "Extended";

/** A grant as Entitlement stores it, with the account its subscription belongs to (entitlement §2). */
export interface StoredGrant {
  readonly grantId: Uuid;
  readonly accountId: Uuid;
  readonly featureKey: string;
  readonly quota: number | null;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly endedAt: Date | null;
  readonly endReason: GrantEndReason | null;
  readonly extendsGrantId: Uuid | null;
}

export interface NewGrant {
  readonly grantId: Uuid;
  readonly subscriptionId: Uuid;
  readonly featureKey: string;
  readonly quota: number | null;
  readonly reason: string;
  readonly grantedBy: Uuid;
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly extendsGrantId: Uuid | null;
}

export interface GrantRepository {
  /** @ensures The grant, or null. */
  find(grantId: Uuid): Promise<StoredGrant | null>;

  /**
   * @ensures The account's subscription in force at `at`, or null.
   * @relies-on db: subscription_one_in_force
   */
  subscriptionInForce(accountId: Uuid, at: Date): Promise<Uuid | null>;

  /** @ensures The grant is stored. */
  insert(grant: NewGrant): Promise<void>;

  /**
   * Ends a grant that has not ended, atomically (a concurrent ending waits, then finds it ended).
   *
   * @returns Whether this call ended it.
   */
  end(
    grantId: Uuid,
    ending: { readonly at: Date; readonly by: Uuid; readonly reason: GrantEndReason },
  ): Promise<boolean>;

  /** @ensures At most `limit` grants not ended whose expiry is at or before `at`, earliest expiry first. */
  expiredNotEnded(at: Date, limit: number): Promise<readonly StoredGrant[]>;

  /** @ensures The grant that extends this one (`extends_grant_id`), or null. */
  extensionOf(grantId: Uuid): Promise<StoredGrant | null>;
}

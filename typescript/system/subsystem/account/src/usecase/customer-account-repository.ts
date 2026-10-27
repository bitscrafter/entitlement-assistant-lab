import type { Uuid } from "../../../../kernel/identifier.ts";
import type { HoldReason } from "../model/hold.ts";

export interface CustomerAccount {
  readonly accountId: Uuid;
  readonly displayName: string;
  /** Advanced by every change applied to the account; a change prepared on an older version is stale (SU-4). */
  readonly version: number;
  readonly accountCategory: "Standalone" | "OrganizationMember";
  readonly customerId: Uuid;
  readonly customerKind: "Organization" | "Individual";
  readonly holds: readonly HoldReason[];
}

export interface CustomerAccountRepository {
  /** @ensures The customer account with this id and the reasons of its unreleased holds, or null. */
  findById(accountId: Uuid): Promise<CustomerAccount | null>;

  /** @ensures The customer's account, or null (one per customer, CM-6). */
  findByCustomer(customerId: Uuid): Promise<CustomerAccount | null>;

  /** @ensures At most `limit` customer accounts whose display name contains `fragment`, ignoring case, by display name. */
  searchByDisplayName(fragment: string, limit: number): Promise<readonly CustomerAccount[]>;

  /**
   * The account's version, its row locked until the caller's transaction ends: no change to the account commits
   * in between (grants-and-approvals D8).
   *
   * @ensures The version, or null when no account has this id.
   */
  lockVersion(accountId: Uuid): Promise<number | null>;

  /** @ensures The account's version is one more. */
  advanceVersion(accountId: Uuid): Promise<void>;
}

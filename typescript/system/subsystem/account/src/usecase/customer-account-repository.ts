import type { Uuid } from "../../../../kernel/identifier.ts";
import type { HoldReason } from "../model/hold.ts";

export interface CustomerAccount {
  readonly accountId: Uuid;
  readonly displayName: string;
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

  /** @ensures Every customer account whose display name contains `fragment`, ignoring case, ordered by display name. */
  searchByDisplayName(fragment: string): Promise<readonly CustomerAccount[]>;
}

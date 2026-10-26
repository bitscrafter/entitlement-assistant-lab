import type { Uuid } from "../../../../kernel/identifier.ts";
import { holdReasonCodes } from "../model/hold.ts";
import type { CustomerAccount, CustomerAccountRepository } from "./customer-account-repository.ts";

export interface CustomerAccountView {
  readonly accountId: Uuid;
  readonly displayName: string;
  readonly accountCategory: "Standalone" | "OrganizationMember";
  readonly customerId: Uuid;
  readonly customerKind: "Organization" | "Individual";
  /** One reason code per unreleased hold, sorted; empty exactly when the account is active. */
  readonly holdReasonCodes: readonly string[];
}

/** A customer account, loaded fresh, with its holds as reason codes (account §3). */
export class GetCustomerAccount {
  readonly #accounts: CustomerAccountRepository;

  constructor(dependencies: { readonly accounts: CustomerAccountRepository }) {
    this.#accounts = dependencies.accounts;
  }

  /**
   * @ensures The customer account with this id, or null when there is none (an internal account included).
   * @relies-on db: customer_account_account_fk (a customer account is an account of kind Customer)
   */
  async execute(accountId: Uuid): Promise<CustomerAccountView | null> {
    const account = await this.#accounts.findById(accountId);
    return account === null ? null : toView(account);
  }

  /** @ensures The customer's account, or null. */
  async byCustomer(customerId: Uuid): Promise<CustomerAccountView | null> {
    const account = await this.#accounts.findByCustomer(customerId);
    return account === null ? null : toView(account);
  }

  /** @ensures Every customer account whose display name contains `fragment`, ignoring case, ordered by display name. */
  async searchByDisplayName(fragment: string): Promise<readonly CustomerAccountView[]> {
    return (await this.#accounts.searchByDisplayName(fragment)).map(toView);
  }
}

function toView(account: CustomerAccount): CustomerAccountView {
  return {
    accountId: account.accountId,
    displayName: account.displayName,
    accountCategory: account.accountCategory,
    customerId: account.customerId,
    customerKind: account.customerKind,
    holdReasonCodes: holdReasonCodes(account.holds),
  };
}

import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CustomerAccountRepository } from "./customer-account-repository.ts";

/** The version of a customer account, which every applied change advances (SU-4). Internal: Support calls it. */
export class AccountVersions {
  readonly #accounts: CustomerAccountRepository;

  constructor(dependencies: { readonly accounts: CustomerAccountRepository }) {
    this.#accounts = dependencies.accounts;
  }

  /** @ensures The version, the account locked until the caller's transaction ends; null for no such account. */
  locked(accountId: Uuid): Promise<number | null> {
    return this.#accounts.lockVersion(accountId);
  }

  /** @ensures The version advanced, in the caller's transaction. */
  advance(accountId: Uuid): Promise<void> {
    return this.#accounts.advanceVersion(accountId);
  }
}

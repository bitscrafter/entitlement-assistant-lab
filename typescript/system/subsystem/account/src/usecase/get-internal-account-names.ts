import type { Uuid } from "../../../../kernel/identifier.ts";
import type { InternalAccountRepository } from "./internal-account-repository.ts";

/** The display names of internal accounts, as other subsystems show who acted (account §2). */
export class GetInternalAccountNames {
  readonly #accounts: InternalAccountRepository;

  constructor(dependencies: { readonly accounts: InternalAccountRepository }) {
    this.#accounts = dependencies.accounts;
  }

  /** @ensures Each id that names an internal account, with its display name; other ids are left out. */
  async execute(accountIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>> {
    const names = new Map<Uuid, string>();
    for (const accountId of new Set(accountIds)) {
      const account = await this.#accounts.findById(accountId);
      if (account !== null) names.set(accountId, account.accountDisplayName);
    }
    return names;
  }
}

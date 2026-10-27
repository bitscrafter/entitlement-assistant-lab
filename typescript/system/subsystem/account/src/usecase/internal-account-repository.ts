import type { Uuid } from "../../../../kernel/identifier.ts";
import type { HoldReason } from "../model/principal.ts";

export interface InternalAccount {
  readonly accountId: Uuid;
  readonly accountDisplayName: string;
  readonly internalIdentityId: Uuid;
  readonly identityKind: "Employee" | "System";
}

export interface InternalAccountRepository {
  /** @ensures The identity's internal account, or null. */
  findByIdentity(internalIdentityId: Uuid): Promise<InternalAccount | null>;

  /** @ensures The internal account with this id, or null. */
  findById(accountId: Uuid): Promise<InternalAccount | null>;

  /** @ensures The reasons of every hold on the account that has not been released. */
  unreleasedHolds(accountId: Uuid): Promise<readonly HoldReason[]>;

  /** @ensures The account of the system identity with this name (`grant-expiry`, `approval-process`), or null. */
  systemAccountIdNamed(name: string): Promise<Uuid | null>;
}

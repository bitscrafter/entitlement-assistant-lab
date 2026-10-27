import type { NormalizedEmail } from "../../../../kernel/email.ts";
import type { Uuid } from "../../../../kernel/identifier.ts";

export interface Individual {
  readonly customerId: Uuid;
  readonly email: NormalizedEmail;
  readonly givenName: string;
  readonly familyName: string;
}

export interface CustomerRepository {
  /** @ensures The individual with this normalized email, or null. */
  findIndividualByEmail(email: NormalizedEmail): Promise<Individual | null>;

  /** @ensures The individuals with these customer ids; ids of no individual are left out. */
  individualsByIds(customerIds: readonly Uuid[]): Promise<readonly Individual[]>;

  /** @ensures True exactly when the individual's membership in the organization started by `at` and had not ended. */
  hasActiveMembership(individualId: Uuid, organizationId: Uuid, at: Date): Promise<boolean>;
}

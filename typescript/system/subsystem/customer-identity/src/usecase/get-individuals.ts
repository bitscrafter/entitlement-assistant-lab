import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CustomerRepository, Individual } from "./customer-repository.ts";

/** The individuals behind customer ids (for showing people by email). */
export class GetIndividuals {
  readonly #customers: CustomerRepository;

  constructor(dependencies: { readonly customers: CustomerRepository }) {
    this.#customers = dependencies.customers;
  }

  /** @ensures The individuals among `customerIds`; organizations and unknown ids are left out. */
  async execute(customerIds: readonly Uuid[]): Promise<readonly Individual[]> {
    return customerIds.length === 0 ? [] : this.#customers.individualsByIds(customerIds);
  }
}

import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CustomerRepository } from "./customer-repository.ts";

/** Whether an individual belongs to an organization at an instant (CI-4: membership justifies roles there). */
export class HasActiveMembership {
  readonly #customers: CustomerRepository;

  constructor(dependencies: { readonly customers: CustomerRepository }) {
    this.#customers = dependencies.customers;
  }

  /** @ensures True exactly when the membership started by `at` and has not ended by then. */
  async execute(request: {
    readonly individualId: Uuid;
    readonly organizationId: Uuid;
    readonly at: Date;
  }): Promise<boolean> {
    return this.#customers.hasActiveMembership(request.individualId, request.organizationId, request.at);
  }
}

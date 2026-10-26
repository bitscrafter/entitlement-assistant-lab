import { normalizeEmail } from "../../../../kernel/email.ts";
import type { CustomerRepository, Individual } from "./customer-repository.ts";

export type { Individual };

/** The individual a person's email names (customer identity §3: emails are compared normalized, CM-10). */
export class FindIndividualByEmail {
  readonly #customers: CustomerRepository;

  constructor(dependencies: { readonly customers: CustomerRepository }) {
    this.#customers = dependencies.customers;
  }

  /** @ensures The individual whose normalized email equals `normalizeEmail(email)`, or null. */
  async execute(email: string): Promise<Individual | null> {
    return this.#customers.findIndividualByEmail(normalizeEmail(email));
  }
}

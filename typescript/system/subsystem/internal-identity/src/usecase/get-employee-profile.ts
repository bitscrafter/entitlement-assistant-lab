import type { Uuid } from "../../../../kernel/identifier.ts";
import type { EmployeeProfile } from "../model/internal-identity.ts";
import type { EmployeeRepository } from "./employee-repository.ts";

/** @ensures The employee's status and job attributes, or null when the identity is not an employee. */
export class GetEmployeeProfile {
  readonly #employees: EmployeeRepository;

  constructor(dependencies: { readonly employees: EmployeeRepository }) {
    this.#employees = dependencies.employees;
  }

  execute(internalIdentityId: Uuid): Promise<EmployeeProfile | null> {
    return this.#employees.findProfile(internalIdentityId);
  }
}

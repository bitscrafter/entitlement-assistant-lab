import type { Clock } from "../../../../port/clock.ts";
import { checkAuthenticationMethod } from "../model/contact-authentication.ts";
import type {
  ActionRefusal,
  CaseActionEnforcement,
  CaseActionRequest,
  CaseAssigneeCheck,
  CaseRefusal,
} from "./case-action-enforcement.ts";
import type { CaseRepository } from "./case-repository.ts";

export type AuthenticateContactResult =
  | { readonly kind: "Authenticated" }
  | { readonly kind: "AuthenticationFailed" }
  | { readonly kind: "ContactNotSet" }
  | { readonly kind: "MethodNotAccepted" }
  | { readonly kind: "MethodNotOfKind" }
  | CaseRefusal
  | ActionRefusal;

/** Records how the CSR authenticated the contact (SU-10, case-lifecycle D4, D5). */
export class AuthenticateContact {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: CaseActionEnforcement;
  readonly #cases: CaseRepository;
  readonly #clock: Clock;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: CaseActionEnforcement;
    readonly cases: CaseRepository;
    readonly clock: Clock;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#cases = dependencies.cases;
    this.#clock = dependencies.clock;
  }

  /**
   * @ensures A method not accepted, or not of its kind, is refused before anything is decided or recorded.
   * @ensures Only the case's assignee; `case.authenticate-contact` decided with `account.read` on the contact.
   * @ensures Without a contact: `ContactNotSet`, `Failed` (`support.contact-not-set`).
   * @ensures A failed check: `AuthenticationFailed`, `Failed` (`support.contact-authentication-failed`), and any
   *          earlier authentication cleared.
   * @ensures A passed check records kind, method, the CSR, and now.
   */
  async execute(
    request: CaseActionRequest & { readonly kind: string; readonly method: string; readonly passed: boolean },
  ): Promise<AuthenticateContactResult> {
    const method = checkAuthenticationMethod(request.kind, request.method);
    if (method.kind === "NotAccepted") return { kind: "MethodNotAccepted" };
    if (method.kind === "NotOfKind") return { kind: "MethodNotOfKind" };
    const assigned = await this.#check.execute(request);
    if (assigned.kind !== "Assigned") return assigned;
    const contactAccountId = assigned.supportCase.contactAccountId;
    const acted = await this.#enforcement.act<
      | { readonly kind: "Authenticated" }
      | { readonly kind: "AuthenticationFailed" }
      | { readonly kind: "ContactNotSet" }
    >(request, "case.authenticate-contact", contactAccountId, async () => {
      if (contactAccountId === null) {
        return {
          outcome: "Failed",
          reasonCode: "support.contact-not-set",
          result: { kind: "ContactNotSet" } as const,
        };
      }
      if (!request.passed) {
        await this.#cases.clearAuthentication(request.caseId);
        return {
          outcome: "Failed",
          reasonCode: "support.contact-authentication-failed",
          result: { kind: "AuthenticationFailed" } as const,
        };
      }
      await this.#cases.recordAuthentication(request.caseId, {
        authenticatedAt: this.#clock.now(),
        kind: method.authenticationKind,
        method: method.method,
        authenticatedBy: request.principalAccountId,
      });
      return { outcome: "Succeeded", result: { kind: "Authenticated" } as const };
    });
    return acted.kind === "Acted" ? acted.outcome.result : acted;
  }
}

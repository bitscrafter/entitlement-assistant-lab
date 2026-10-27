import type { Uuid } from "../../../../kernel/identifier.ts";
import type { ListAccountRoles } from "../../../access/src/usecase/list-account-roles.ts";
import type { CustomerAccountView } from "../../../account/src/usecase/get-customer-account.ts";
import {
  type AuthenticationKind,
  type AuthenticationMethod,
  authenticationExpiresAt,
} from "../model/contact-authentication.ts";
import type { CaseActionRequest, CaseAssigneeCheck, CaseRefusal } from "./case-action-enforcement.ts";
import type { CloseReason } from "./case-repository.ts";
import type { ReadEnforcement } from "./read-enforcement.ts";
import type { ReadRequest } from "./read-request.ts";

/** An account of the case as the CSR may see it now (case-lifecycle D14, D15). */
export type AccountPart =
  | { readonly accountId: Uuid; readonly readable: false }
  | {
      readonly accountId: Uuid;
      readonly readable: true;
      readonly displayName: string;
      readonly holds: readonly string[];
    };

export type ContactPart =
  | { readonly accountId: Uuid; readonly readable: false }
  | (Extract<AccountPart, { readonly readable: true }> & {
      /** The contact's roles in the subject; null unless the subject is readable too (D15, discovery 1). */
      readonly rolesInSubject: readonly string[] | null;
    });

export interface CaseView {
  readonly caseId: Uuid;
  readonly subject: AccountPart | null;
  readonly contact: ContactPart | null;
  readonly contactAuthentication: {
    readonly kind: AuthenticationKind;
    readonly method: AuthenticationMethod;
    readonly authenticatedBy: Uuid;
    readonly authenticatedAt: Date;
    readonly expiresAt: Date;
  } | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly closeReason: CloseReason | null;
  readonly summary: string | null;
}

const USE_CASE = "GetCase";

/** The case as its assignee sees it, every account in it read like any other (api.md §5, case-lifecycle D15). */
export class GetCase {
  readonly #check: CaseAssigneeCheck;
  readonly #enforcement: ReadEnforcement;
  readonly #listAccountRoles: ListAccountRoles;

  constructor(dependencies: {
    readonly check: CaseAssigneeCheck;
    readonly enforcement: ReadEnforcement;
    readonly listAccountRoles: ListAccountRoles;
  }) {
    this.#check = dependencies.check;
    this.#enforcement = dependencies.enforcement;
    this.#listAccountRoles = dependencies.listAccountRoles;
  }

  /**
   * @ensures Only the case's assignee.
   * @ensures The subject and the contact are each read through the read enforcement (one audited `account.read`
   *          decision each, `GetCase`); a part the CSR may not read shows only its id.
   * @ensures The contact's roles in the subject only when both are readable.
   * @ensures The authentication with its expiry (D5), shown even when expired.
   */
  async execute(request: CaseActionRequest): Promise<CaseView | CaseRefusal> {
    const assigned = await this.#check.execute(request, "Read");
    if (assigned.kind !== "Assigned") return assigned;
    const supportCase = assigned.supportCase;
    const read: ReadRequest = { ...request, toolCallId: null };
    const partOf = async (accountId: Uuid): Promise<AccountPart> => {
      const result = await this.#enforcement.read(read, USE_CASE, accountId, async (account) =>
        readablePart(account),
      );
      return "readable" in result ? result : { accountId, readable: false };
    };
    const subject = supportCase.subjectAccountId === null ? null : await partOf(supportCase.subjectAccountId);
    const contactPart =
      supportCase.contactAccountId === null ? null : await partOf(supportCase.contactAccountId);
    const contact: ContactPart | null =
      contactPart === null || !contactPart.readable
        ? contactPart
        : {
            ...contactPart,
            rolesInSubject:
              subject?.readable === true
                ? (
                    await this.#listAccountRoles.execute({
                      memberAccountId: contactPart.accountId,
                      memberOfAccountId: subject.accountId,
                    })
                  )
                    .map((assignment) => assignment.roleKey)
                    .sort()
                : null,
          };
    const authentication = supportCase.contactAuthentication;
    return {
      caseId: supportCase.caseId,
      subject,
      contact,
      contactAuthentication:
        authentication === null
          ? null
          : { ...authentication, expiresAt: authenticationExpiresAt(authentication.authenticatedAt) },
      openedAt: supportCase.openedAt,
      closedAt: supportCase.closedAt,
      closeReason: supportCase.closeReason,
      summary: supportCase.summary,
    };
  }
}

function readablePart(account: CustomerAccountView): AccountPart {
  return {
    accountId: account.accountId,
    readable: true,
    displayName: account.displayName,
    holds: account.holdReasonCodes,
  };
}

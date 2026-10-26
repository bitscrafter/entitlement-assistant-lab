import { encodeIdentifier } from "../../../../kernel/identifier.ts";
import { quotedName } from "../../../../kernel/quoted-name.ts";
import type { CaseView } from "../../../../subsystem/support/src/usecase/get-case.ts";

const METHOD_WORDS: Readonly<Record<string, string>> = {
  SecurityQuestion: "security questions",
  AccountDetails: "account details",
  SupportPasscode: "support passcode",
  OneTimeCode: "one-time code",
};

const timeOf = (instant: Date) => instant.toISOString().slice(11, 16);

/**
 * The case's state as the assistant is told it at each turn (case-lifecycle D22): one short line, accounts and
 * people named by reference (CM-19), names quoted so none can pass for the line's own text (review R4-1), an account
 * the CSR may not read never named.
 *
 * @ensures The case number first; then the subject, the contact (with their roles in the subject when both are
 *          readable), and the authentication with its expiry, or that each is not set.
 */
export function caseStateLine(view: CaseView, contactEmail: string | null, now: Date): string {
  const subject =
    view.subject === null
      ? "subject not set"
      : view.subject.readable
        ? `subject ${quotedName(view.subject.displayName)} [${encodeIdentifier("acc", view.subject.accountId)}]`
        : "subject: an account you may not read";
  let contact = "contact not set";
  if (view.contact !== null) {
    if (!view.contact.readable) contact = "contact: an account you may not read";
    else {
      const reference =
        contactEmail === null ? encodeIdentifier("acc", view.contact.accountId) : contactEmail;
      contact = `contact ${quotedName(view.contact.displayName)} [${reference}]`;
      const roles = view.contact.rolesInSubject;
      if (roles !== null && view.subject?.readable === true)
        contact +=
          roles.length === 0
            ? `, no role in ${quotedName(view.subject.displayName)}`
            : `, ${roles.join(" and ")} in ${quotedName(view.subject.displayName)}`;
    }
  }
  const authentication = view.contactAuthentication;
  const authenticated =
    authentication === null
      ? "not authenticated"
      : authentication.expiresAt.getTime() <= now.getTime()
        ? `authentication expired at ${timeOf(authentication.expiresAt)}`
        : `authenticated (${authentication.kind} - ${METHOD_WORDS[authentication.method] ?? authentication.method}) until ${timeOf(authentication.expiresAt)}`;
  return `Case ${encodeIdentifier("cse", view.caseId)}: ${subject} · ${contact} · ${authenticated}.`;
}

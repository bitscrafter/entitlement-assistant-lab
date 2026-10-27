import type { CaseState } from "./cases-client.ts";

/**
 * What the case panel tells the CSR to do or not to say (case-lifecycle D20), from what the case view already shows:
 * the CSR sees the account, the contact hears what the CSR says.
 *
 * @ensures The reassignment hint when the subject is not readable.
 * @ensures Once a subject is set and readable: authenticate first, when the contact is not authenticated or the
 *          authentication expired at or before `now`; share nothing, when the contact holds no role in the subject.
 */
export function caseGuidance(state: CaseState, now: Date): readonly string[] {
  const subject = state.subject;
  if (subject === null) return [];
  if (!subject.readable)
    return ["You may no longer read this account. Ask a supervisor to reassign the case."];
  const guidance: string[] = [];
  const authentication = state.contact_authentication;
  if (authentication === null || new Date(authentication.expires_at).getTime() <= now.getTime())
    guidance.push(`Authenticate the contact before sharing anything about ${subject.display_name}.`);
  const contact = state.contact;
  if (contact?.readable === true && contact.roles_in_subject?.length === 0)
    guidance.push(
      `${contact.display_name} holds no role in ${subject.display_name}: share nothing about it.`,
    );
  return guidance;
}

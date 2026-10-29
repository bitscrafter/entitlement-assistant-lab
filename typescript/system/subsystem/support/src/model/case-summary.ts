/**
 * A closed case's summary is read by anyone who may read the subject account, now and later, so it holds no person's
 * email address (case-lifecycle discoveries 17, 19): the assistant's draft and the summary the CSR submits alike.
 * Names are not caught (no reliable pattern): the panel's note and the CSR's review cover them.
 */
const EMAIL_IN_TEXT = /[^\s@[\]()<>"'`,;:]+@[^\s@[\]()<>"'`,;:]+\.[A-Za-z]{2,}/;

/** @ensures Whether the text contains anything shaped like an email address. */
export function containsEmailAddress(text: string): boolean {
  return EMAIL_IN_TEXT.test(text);
}

/** Why such a summary is refused, as the CSR and the assistant read it. */
export const SUMMARY_WITH_EMAIL =
  "A case summary may not contain an email address: anyone who may read the account reads it. Rewrite it without one.";

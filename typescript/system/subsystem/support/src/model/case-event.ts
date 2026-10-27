import { quotedName } from "../../../../kernel/quoted-name.ts";

/**
 * The line a lifecycle record becomes in the case's conversation (case-lifecycle D21): what happened, as recorded.
 */

/** The actions whose records become events; the rest (decisions, closing) never do. */
export const EVENT_ACTIONS = ["case.set-subject", "case.set-contact", "case.authenticate-contact"] as const;

/** How a method reads in an event. */
const METHOD_WORDS: Readonly<Record<string, string>> = {
  SecurityQuestion: "security questions",
  AccountDetails: "account details",
  SupportPasscode: "support passcode",
  OneTimeCode: "one-time code",
};

export interface EventRecord {
  readonly actionKey: string;
  readonly outcome: string;
  readonly reasons: readonly string[];
  readonly occurredAt: Date;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** `15:02` in UTC, as the case panel shows times. */
const timeOf = (instant: Date) => instant.toISOString().slice(11, 16);

/**
 * @ensures A subject or contact set: the name kept for it (`names.account`), quoted (`quotedName`: it cannot pass for event text,
 *          review R4-1), who, and when.
 * @ensures A passed authentication: kind, method, who, when, and its expiry (`expiresAt`); a failed one: kind,
 *          method, `failed`, who, and when.
 * @ensures Null for any other record: a decision, a conflict, a failure other than the check's, or closing.
 */
export function caseEventLineOf(
  record: EventRecord,
  names: { readonly actor: string; readonly account: string | null; readonly expiresAt: Date | null },
): string | null {
  const account = names.account === null || names.account === "" ? "an account" : quotedName(names.account);
  const at = `${names.actor}, at ${timeOf(record.occurredAt)}`;
  const authenticated = () => {
    const kind = String(record.detail.kind ?? "");
    const method = METHOD_WORDS[String(record.detail.method ?? "")] ?? String(record.detail.method ?? "");
    return `Contact authenticated: ${kind} - ${method}`;
  };
  if (record.outcome === "Succeeded") {
    switch (record.actionKey) {
      case "case.set-subject":
        return `Subject set: ${account} (${at}).`;
      case "case.set-contact":
        return `Contact set: ${account} (${at}).`;
      case "case.authenticate-contact":
        return `${authenticated()} (${at}${names.expiresAt === null ? "" : `, until ${timeOf(names.expiresAt)}`}).`;
    }
  }
  if (
    record.outcome === "Failed" &&
    record.actionKey === "case.authenticate-contact" &&
    record.reasons.includes("support.contact-authentication-failed")
  )
    return `${authenticated()} failed (${at}).`;
  return null;
}

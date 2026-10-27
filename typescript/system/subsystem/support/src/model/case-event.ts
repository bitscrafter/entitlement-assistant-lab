import { quotedName } from "../../../../kernel/quoted-name.ts";

/**
 * The line a lifecycle record becomes in the case's conversation (case-lifecycle D21): what happened, as recorded.
 */

/** The actions whose records become events; the rest (decisions, closing) never do. */
export const EVENT_ACTIONS = [
  "case.set-subject",
  "case.set-contact",
  "case.authenticate-contact",
  // grants-and-approvals D15: every change and approval outcome.
  "change-request.prepare",
  "change-request.confirm",
  "change-request.cancel",
  "change-request.apply",
  "approval.decide",
  "approval.expire",
] as const;

const DENIAL_WORDS: Readonly<Record<string, string>> = {
  PolicyLimit: "policy limit",
  InsufficientJustification: "insufficient justification",
  CustomerNotEligible: "customer not eligible",
  Other: "other",
};

/**
 * What a change record's detail says about the change, as words: `audit log export, 7 days`, `seats +10, 5 days`.
 * Only catalog keys and numbers are shown, so no free text reaches an event.
 */
function changeWords(detail: Readonly<Record<string, unknown>>, withDays: boolean): string {
  const key =
    typeof detail.feature_key === "string" && /^[a-z0-9-]{1,64}$/.test(detail.feature_key)
      ? detail.feature_key
      : null;
  const feature = key === null ? "a feature" : key.replace(/-/g, " ");
  const quota = typeof detail.quota === "number" ? ` +${detail.quota}` : "";
  const days = typeof detail.duration_days === "number" ? detail.duration_days : null;
  return `${feature}${quota}${withDays && days !== null ? `, ${days} ${days === 1 ? "day" : "days"}` : ""}`;
}

/** `until 2026-10-29` from a record's `expires_at`, or nothing. */
function untilWords(detail: Readonly<Record<string, unknown>>): string {
  const expiresAt = typeof detail.expires_at === "string" ? new Date(detail.expires_at) : null;
  return expiresAt === null || Number.isNaN(expiresAt.getTime())
    ? ""
    : ` until ${expiresAt.toISOString().slice(0, 10)}`;
}

/** The line of a change or approval record (grants-and-approvals D15); null for one that is not an outcome. */
function changeEventLineOf(record: EventRecord, at: string, actor: string): string | null {
  const detail = record.detail;
  const kind = detail.change_kind;
  const noun = kind === "RevokeGrant" ? "Revocation" : kind === "ExtendGrant" ? "Extension" : "Grant";
  const time = `at ${at.slice(at.lastIndexOf("at ") + 3)}`;
  if (record.outcome === "Failed") {
    if (record.actionKey !== "change-request.confirm" && record.actionKey !== "change-request.apply")
      return null;
    return record.reasons.includes("support.stale-change-request")
      ? `Change canceled: the account changed since it was prepared (${at}).`
      : `Change refused when applied: ${changeWords(detail, false)} (${at}).`;
  }
  if (record.outcome !== "Succeeded") return null;
  switch (record.actionKey) {
    case "change-request.prepare":
      return `${noun} prepared: ${changeWords(detail, kind !== "RevokeGrant")} (${at}).`;
    case "change-request.confirm":
    case "change-request.apply": {
      if (detail.status === "AwaitingApproval")
        return `Awaiting approval: ${changeWords(detail, true)} (${at}).`;
      const how =
        record.actionKey === "change-request.apply"
          ? "Grant applied after approval"
          : "Grant confirmed and applied";
      if (kind === "RevokeGrant") return `Grant revoked: ${changeWords(detail, false)} (${at}).`;
      if (kind === "ExtendGrant")
        return `Grant extended: ${changeWords(detail, false)}${untilWords(detail)} (${at}).`;
      return `${how}: ${changeWords(detail, false)}${untilWords(detail)} (${at}).`;
    }
    case "change-request.cancel":
      return `Change canceled: ${noun.toLowerCase()} of ${changeWords(detail, false)} (${at}).`;
    case "approval.decide":
      return detail.decision === "Denied"
        ? `Denied by ${actor}: ${DENIAL_WORDS[String(detail.decision_reason)] ?? "no reason"} (${time}).`
        : `Approved by ${actor} (${time}).`;
    case "approval.expire":
      return `Approval expired: no decision in time (${time}).`;
  }
  return null;
}

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
  const change = changeEventLineOf(record, at, names.actor);
  if (change !== null) return change;
  if (
    record.outcome === "Failed" &&
    record.actionKey === "case.authenticate-contact" &&
    record.reasons.includes("support.contact-authentication-failed")
  )
    return `${authenticated()} failed (${at}).`;
  return null;
}

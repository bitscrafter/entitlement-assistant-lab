/**
 * The structure of one assistant reply: the tools it called, the model's words, and the Details built from the tools'
 * results. Details come only from tool results (the system of record), never from the model's text.
 */

/** A message part as the Agents SDK's client holds it. */
export interface ReplyPart {
  readonly type: string;
  readonly text?: string;
  readonly state?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errorText?: string;
}

export interface ToolCallView {
  readonly toolName: string;
  readonly state: "done" | "refused" | "running";
  readonly input: unknown;
  readonly output: unknown;
  readonly errorText: string | null;
  /** How many identical calls (same tool, input, and result) this one stands for. */
  readonly times: number;
}

export type DetailLine =
  | {
      readonly kind: "feature";
      readonly featureKey: string;
      readonly included: boolean;
      readonly quota: number | "unlimited" | null;
      readonly sources: readonly string[];
      readonly reasons: readonly string[];
      readonly remedy: string | null;
    }
  | { readonly kind: "nothing-effective"; readonly reasons: readonly string[] }
  | {
      readonly kind: "access";
      readonly personEmail: string;
      readonly featureKey: string;
      readonly operation: string;
      readonly allowed: boolean;
      readonly grantedBy: readonly string[];
      readonly reasons: readonly string[];
      readonly remedy: string | null;
    };

export interface AccountCard {
  readonly accountId: string;
  readonly displayName: string;
  readonly plan: string | null;
  readonly term: string | null;
  readonly lines: readonly DetailLine[];
}

export interface ReplyView {
  readonly tools: readonly ToolCallView[];
  readonly text: string;
  readonly accounts: readonly AccountCard[];
  /** Lookups that matched several accounts: the CSR picks one. */
  readonly choices: readonly {
    readonly accountId: string;
    readonly displayName: string;
    readonly roles: readonly string[];
  }[];
  /** A lookup matched more readable accounts than it lists: the CSR refines the query (explain-access D14). */
  readonly moreMatches: boolean;
  /**
   * A lookup searched by part of a name, so its answer is bounded (D14) and shows only readable accounts. The notice
   * depends only on the query the CSR's turn sent, never on what the search found, so it reveals nothing (AU-6).
   */
  readonly nameSearch: boolean;
  /** Accounts the assistant proposed as the case's subject; the CSR sets one with a click (case-lifecycle D1). */
  readonly proposedSubjects: readonly string[];
  /** The latest summary the assistant drafted, for the CSR to review when closing (D8); null when none. */
  readonly draftedSummary: string | null;
  /** Accounts a lookup by email showed as the person's own: the ones the CSR may set as the contact (D3). */
  readonly ownAccounts: readonly string[];
  /** Refusals that name no account (not found, denied by policy), in plain words. */
  readonly refusals: readonly string[];
}

type Json = Readonly<Record<string, unknown>>;

/** Shown as the answer when the model wrote a tool call as text instead of words (discovery 33). */
export const NO_ANSWER = "No answer was written; see Details.";

/** A tool call written out as JSON, as Llama does when tools are refused on its last step. */
const TOOL_CALL_TEXT = /\{\s*"name"\s*:\s*"[A-Za-z_]+"\s*,\s*"parameters"\s*:/;

/**
 * How the model names an account or a person: a reference in square brackets, `[acc_…]` or `[carol@acme.com]`. The
 * screen writes each one as the database stores it, so a name in the answer is never the model's spelling (ADR CM-19).
 */
const REFERENCE = /\[(acc_[A-Za-z0-9_-]{22}|[^\s[\]@]+@[^\s[\]@]+)\]/g;

/** Shown for a reference to an account or person that no tool of this reply returned. */
export const UNKNOWN_ACCOUNT = "(an account not in this reply's results)";
export const UNKNOWN_PERSON = "(a person not in this reply's results)";

/** Shown with every name search, whatever it found (review round 2, R2-1). */
export const NAME_SEARCH_NOTICE =
  "Only accounts you may read are shown, and a name search checks at most 50 matches. If this isn't the account you meant, use a longer part of the name, an email, or the account id.";

/**
 * @ensures Every `[acc_…]` reads as that account's stored display name and every `[email]` as the stored email, when a
 *          tool of this reply returned them; otherwise as `UNKNOWN_ACCOUNT` or `UNKNOWN_PERSON`.
 * @ensures Text outside a reference is unchanged.
 */
export function resolveReferences(
  text: string,
  accounts: ReadonlyMap<string, string>,
  people: ReadonlyMap<string, string>,
): string {
  return text.replace(REFERENCE, (_whole, reference: string) =>
    reference.startsWith("acc_") && !reference.includes("@")
      ? (accounts.get(reference) ?? UNKNOWN_ACCOUNT)
      : (people.get(reference.toLowerCase()) ?? UNKNOWN_PERSON),
  );
}

const asRecord = (value: unknown): Json | null =>
  typeof value === "object" && value !== null ? (value as Json) : null;
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asStrings = (value: unknown): readonly string[] => (Array.isArray(value) ? value.map(asString) : []);

/** `business` reads as `Business`; `audit-log-export` as `Audit log export`. */
export function titleOf(key: string): string {
  const words = key.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An ISO instant as the calendar day it falls on (`2026-11-01`). */
export function dayOf(instant: string): string {
  return instant.slice(0, 10);
}

/** `plan:business` reads as `Business plan`; `addon:x` as `X add-on`; `grant:grt_…` as `grant grt_…`. */
export function sourceLabel(source: string): string {
  const [kind = "", key = ""] = source.split(":");
  if (kind === "plan") return `${titleOf(key)} plan`;
  if (kind === "addon") return `${titleOf(key)} add-on`;
  return `grant ${key}`;
}

function termOf(account: Json): string | null {
  const term = asRecord(account.covering_term);
  if (term === null) return null;
  const source = asString(term.source);
  const endsAt = term.ends_at;
  return typeof endsAt === "string" ? `${source}, ends ${dayOf(endsAt)}` : `${source}, open-ended`;
}

function reasonsOf(output: Json): readonly string[] {
  return Array.isArray(output.reasons)
    ? output.reasons.map((reason) => asString(asRecord(reason)?.description))
    : [];
}

function remedyOf(output: Json): string | null {
  const remedy = asRecord(output.remedy);
  if (remedy === null) return null;
  const parts: string[] = [];
  const lowest = remedy.lowest_plan_key;
  if (typeof lowest === "string") parts.push(`lowest plan that includes it: ${titleOf(lowest)}`);
  for (const addon of Array.isArray(remedy.addons) ? remedy.addons : []) {
    const record = asRecord(addon) ?? {};
    const plans = asStrings(record.eligible_plan_keys).map(titleOf);
    parts.push(
      plans.length === 0
        ? `the ${titleOf(asString(record.addon_key))} add-on`
        : `the ${titleOf(asString(record.addon_key))} add-on, with ${plans.join(" or ")}`,
    );
  }
  return parts.length === 0 ? null : parts.join("; ");
}

function stateOf(part: ReplyPart): ToolCallView["state"] {
  if (part.errorText !== undefined) return "refused";
  return part.state === "output-available" ? "done" : "running";
}

/**
 * @ensures `tools` lists every tool part once per distinct tool, input, and result, in order, with how many times.
 * @ensures `text` is the reply's text parts, joined, with every reference resolved from this reply's results
 *          (`resolveReferences`); `NO_ANSWER` when that text writes out a tool call.
 * @ensures `accounts` has one card per account the results name, in the order first named, with every line those
 *          results give it.
 * @ensures `choices` lists the accounts of a several-match lookup that the reply did not go on to show as a card;
 *          `moreMatches` is whether a lookup listed fewer than it matched; `nameSearch` is whether a lookup's query
 *          was part of a name (neither an email nor an account id).
 * @ensures `proposedSubjects` lists each account a `proposed` result named, once; `draftedSummary` is the last
 *          `drafted` summary, or null.
 * @ensures `ownAccounts` lists each account a lookup by email showed as the person's own, once.
 * @ensures A "not found" is reported only when nothing in the reply resolved to an account or a choice; a policy
 *          denial is always reported.
 */
export function replyViewOf(parts: readonly ReplyPart[]): ReplyView {
  const tools: ToolCallView[] = [];
  const cards = new Map<
    string,
    { displayName: string; plan: string | null; term: string | null; lines: DetailLine[] }
  >();
  const choices: ReplyView["choices"][number][] = [];
  const policyDenials: string[] = [];
  let notFound = false;
  const texts: string[] = [];
  const people = new Map<string, string>();
  const knowPerson = (email: string) => {
    if (email !== "") people.set(email.toLowerCase(), email);
  };
  let moreMatches = false;
  let nameSearch = false;
  const proposedSubjects: string[] = [];
  const ownAccounts: string[] = [];
  const ownAccount = (accountId: string) => {
    if (accountId !== "" && !ownAccounts.includes(accountId)) ownAccounts.push(accountId);
  };
  let draftedSummary: string | null = null;

  const cardFor = (account: Json) => {
    const accountId = asString(account.account_id);
    const existing = cards.get(accountId);
    if (existing !== undefined) return existing;
    const plan = typeof account.plan_key === "string" ? titleOf(account.plan_key) : null;
    const created = {
      displayName: asString(account.display_name),
      plan,
      term: termOf(account),
      lines: [] as DetailLine[],
    };
    cards.set(accountId, created);
    return created;
  };

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text !== undefined && part.text !== "") texts.push(part.text);
      continue;
    }
    if (!part.type.startsWith("tool-")) continue;
    const toolName = part.type.slice("tool-".length);
    const lookupByEmail =
      toolName === "find_customer_account" && asString(asRecord(part.input)?.query).includes("@");
    if (toolName === "find_customer_account") {
      const query = asString(asRecord(part.input)?.query).trim();
      if (query !== "" && !query.includes("@") && !query.startsWith("acc_")) nameSearch = true;
    }
    const view: ToolCallView = {
      toolName,
      state: stateOf(part),
      input: part.input,
      output: part.output,
      errorText: part.errorText ?? null,
      times: 1,
    };
    const same = tools.findIndex(
      (tool) =>
        tool.toolName === toolName &&
        JSON.stringify([tool.input, tool.output]) === JSON.stringify([part.input, part.output]),
    );
    if (same >= 0) {
      const earlier = tools[same];
      if (earlier !== undefined) tools[same] = { ...earlier, times: earlier.times + 1 };
      continue;
    }
    tools.push(view);

    const output = asRecord(part.output);
    if (output === null) continue;
    if (output.error === "not_found") notFound = true;
    if (output.error === "access_denied") {
      const details = Array.isArray(output.error_details) ? output.error_details : [];
      policyDenials.push(
        `Denied by policy: ${details.map((detail) => asString(asRecord(detail)?.error_description)).join(" ")}`,
      );
    }
    const account = asRecord(output.account);
    switch (output.result) {
      case "found":
        if (account !== null) {
          cardFor(account);
          for (const email of asStrings(account.owners_and_admins)) knowPerson(email);
          // A lookup by email that found one account found the person's own (explain-access §3).
          if (lookupByEmail) ownAccount(asString(account.account_id));
        }
        break;
      case "ambiguous":
        if (output.more_matches === true) moreMatches = true;
        for (const candidate of Array.isArray(output.candidates) ? output.candidates : []) {
          const record = asRecord(candidate) ?? {};
          if (record.own_account === true) ownAccount(asString(record.account_id));
          choices.push({
            accountId: asString(record.account_id),
            displayName: asString(record.display_name),
            roles: asStrings(record.roles),
          });
        }
        break;
      case "entitled":
        if (account !== null) {
          cardFor(account).lines.push({
            kind: "feature",
            featureKey: asString(output.feature_key),
            included: true,
            quota: (output.quota as number | "unlimited" | null) ?? null,
            sources: asStrings(output.sources).map(sourceLabel),
            reasons: [],
            remedy: null,
          });
        }
        break;
      case "not_entitled":
        if (account !== null) {
          cardFor(account).lines.push({
            kind: "feature",
            featureKey: asString(output.feature_key),
            included: false,
            quota: null,
            sources: [],
            reasons: reasonsOf(output),
            remedy: remedyOf(output),
          });
        }
        break;
      case "listed":
        if (account !== null) {
          const card = cardFor(account);
          const entries = Array.isArray(output.entries) ? output.entries : [];
          if (entries.length === 0)
            card.lines.push({ kind: "nothing-effective", reasons: reasonsOf(output) });
          for (const entry of entries) {
            const record = asRecord(entry) ?? {};
            card.lines.push({
              kind: "feature",
              featureKey: asString(record.feature_key),
              included: true,
              quota: (record.quota as number | "unlimited" | null) ?? null,
              sources: asStrings(record.sources).map(sourceLabel),
              reasons: [],
              remedy: null,
            });
          }
        }
        break;
      case "explained":
        if (account !== null) {
          const findings = Array.isArray(output.findings) ? output.findings : [];
          const access = findings.map(asRecord).find((finding) => finding?.kind === "access");
          knowPerson(asString(output.person_email));
          cardFor(account).lines.push({
            kind: "access",
            personEmail: asString(output.person_email),
            featureKey: asString(output.feature_key),
            operation: asString(output.operation),
            allowed: output.outcome === "Allow",
            grantedBy: asStrings(access?.granted_by_roles).map(titleOf),
            reasons: reasonsOf(output),
            remedy: remedyOf(output),
          });
        }
        break;
      case "proposed":
        if (account !== null) {
          cardFor(account);
          const accountId = asString(account.account_id);
          if (!proposedSubjects.includes(accountId)) proposedSubjects.push(accountId);
        }
        break;
      case "drafted":
        draftedSummary = asString(output.summary);
        break;
      default:
        break;
    }
  }
  const remainingChoices = choices.filter((choice) => !cards.has(choice.accountId));
  const resolved = cards.size > 0 || remainingChoices.length > 0;
  const text = texts.join("\n\n");
  const accountNames = new Map<string, string>(
    choices.map((choice) => [choice.accountId, choice.displayName] as const),
  );
  for (const [accountId, card] of cards) accountNames.set(accountId, card.displayName);
  return {
    tools,
    text: TOOL_CALL_TEXT.test(text) ? NO_ANSWER : resolveReferences(text, accountNames, people),
    accounts: [...cards.entries()].map(([accountId, card]) => ({ accountId, ...card })),
    choices: remainingChoices,
    moreMatches,
    nameSearch,
    proposedSubjects,
    draftedSummary,
    ownAccounts,
    refusals: [
      ...(notFound && !resolved ? ["No account matched, or it is not one you may read."] : []),
      ...policyDenials,
    ],
  };
}

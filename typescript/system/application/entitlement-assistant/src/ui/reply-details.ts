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
  /** Refusals that name no account (not found, denied by policy), in plain words. */
  readonly refusals: readonly string[];
}

type Json = Readonly<Record<string, unknown>>;

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
 * @ensures `text` is the reply's text parts, joined.
 * @ensures `accounts` has one card per account the results name, in the order first named, with every line those
 *          results give it.
 * @ensures `choices` lists the accounts of a several-match lookup that the reply did not go on to show as a card.
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
      case "Found":
        if (account !== null) cardFor(account);
        break;
      case "Ambiguous":
        for (const candidate of Array.isArray(output.candidates) ? output.candidates : []) {
          const record = asRecord(candidate) ?? {};
          choices.push({
            accountId: asString(record.account_id),
            displayName: asString(record.display_name),
            roles: asStrings(record.roles),
          });
        }
        break;
      case "Entitled":
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
      case "NotEntitled":
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
      case "Listed":
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
      case "Explained":
        if (account !== null) {
          const findings = Array.isArray(output.findings) ? output.findings : [];
          const access = findings.map(asRecord).find((finding) => finding?.kind === "access");
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
      default:
        break;
    }
  }
  const remainingChoices = choices.filter((choice) => !cards.has(choice.accountId));
  const resolved = cards.size > 0 || remainingChoices.length > 0;
  return {
    tools,
    text: texts.join("\n\n"),
    accounts: [...cards.entries()].map(([accountId, card]) => ({ accountId, ...card })),
    choices: remainingChoices,
    refusals: [
      ...(notFound && !resolved ? ["No account matched, or it is not one you may read."] : []),
      ...policyDenials,
    ],
  };
}

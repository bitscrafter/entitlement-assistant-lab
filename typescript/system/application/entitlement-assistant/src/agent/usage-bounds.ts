/** The bounds of one turn's cost (usage-guards D4). */

/** At most this many output tokens per model call. */
export const MAXIMUM_OUTPUT_TOKENS = 1024;

/** The model reads at most this many of the latest messages of the conversation. */
export const CONVERSATION_WINDOW = 20;

/** The text a turn answers when the day's model calls are used up, or the assistant is off (D2, D5). */
export const DAILY_ALLOWANCE_TEXT =
  "The assistant's daily allowance for this demo is used up; try again tomorrow (UTC).";

/** Thrown before a model call the day's allowance refuses: the call is never made, so it costs nothing. */
export class DailyAllowanceExhausted extends Error {
  override readonly name = "DailyAllowanceExhausted";

  constructor() {
    super(DAILY_ALLOWANCE_TEXT);
  }
}

/**
 * The latest messages the model reads (D4): a long conversation does not cost more and more.
 *
 * @ensures At most `window` messages, the latest ones, in order, starting at a user message (a reply is never cut
 *          from the question it answers); system messages are left out (case events reach the model in its
 *          instructions).
 */
export function latestConversation<Message extends { readonly role: string }>(
  messages: readonly Message[],
  window = CONVERSATION_WINDOW,
): readonly Message[] {
  const latest = messages.filter((message) => message.role !== "system").slice(-window);
  const firstUser = latest.findIndex((message) => message.role === "user");
  return firstUser < 0 ? latest : latest.slice(firstUser);
}

/**
 * A language model middleware that takes one model call from the day's allowance before each call (D2).
 *
 * @ensures A refused take throws `DailyAllowanceExhausted` and the provider is not called.
 */
export function dailyAllowanceMiddleware(takeModelCall: () => Promise<"Allowed" | "Refused">) {
  const take = async () => {
    if ((await takeModelCall()) === "Refused") throw new DailyAllowanceExhausted();
  };
  return {
    wrapGenerate: async <Result>({ doGenerate }: { doGenerate: () => PromiseLike<Result> }) => {
      await take();
      return doGenerate();
    },
    wrapStream: async <Result>({ doStream }: { doStream: () => PromiseLike<Result> }) => {
      await take();
      return doStream();
    },
  };
}

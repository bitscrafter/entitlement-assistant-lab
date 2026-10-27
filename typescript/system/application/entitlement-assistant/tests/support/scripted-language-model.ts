import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

/** One scripted answer of the model: text for the CSR, tool calls to run, or both. */
export interface ScriptedStep {
  /** When set, the model fails with this message instead of answering. */
  readonly failure?: string;
  readonly text: string;
  readonly toolCalls: readonly {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly arguments: unknown;
  }[];
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/**
 * The scripted language model (spec: "the scripted double"): the AI SDK's mock model, answering each call with the
 * next scripted step, and with the fallback reply once the script runs out.
 */
export class ScriptedLanguageModel {
  readonly #steps: ScriptedStep[] = [];
  readonly #fallbackReply: string;
  readonly model: MockLanguageModelV4;

  constructor(fallbackReply = "Noted.") {
    this.#fallbackReply = fallbackReply;
    this.model = new MockLanguageModelV4({
      doStream: async () => {
        const step = this.#steps.shift();
        if (step?.failure !== undefined) throw new Error(step.failure);
        return { stream: convertArrayToReadableStream(this.#partsOf(step)) } as never;
      },
    });
  }

  script(...steps: readonly ScriptedStep[]): void {
    this.#steps.push(...steps);
  }

  get calls(): number {
    return this.model.doStreamCalls.length;
  }

  /** The output-token bound of each call the model received (usage-guards D4). */
  get maxOutputTokens(): readonly (number | null)[] {
    return (this.model.doStreamCalls as readonly { maxOutputTokens?: number }[]).map(
      (call) => call.maxOutputTokens ?? null,
    );
  }

  /** The system instructions of the model's last call. */
  get lastInstructions(): string {
    const calls = this.model.doStreamCalls as readonly {
      prompt?: readonly { role: string; content: unknown }[];
    }[];
    const prompt = calls.at(-1)?.prompt ?? [];
    return prompt
      .filter((message) => message.role === "system")
      .map((message) => String(message.content))
      .join("\n");
  }

  /** The names of the tools the agent offered the model at its first call, sorted. */
  get offeredTools(): readonly string[] {
    const tools =
      (this.model.doStreamCalls[0] as { tools?: readonly { name: string }[] } | undefined)?.tools ?? [];
    return tools.map((tool) => tool.name).sort();
  }

  #partsOf(step: ScriptedStep | undefined): unknown[] {
    const answer = step ?? { text: this.#fallbackReply, toolCalls: [] };
    return [
      { type: "stream-start", warnings: [] },
      ...(answer.text === ""
        ? []
        : [
            { type: "text-start", id: "text" },
            { type: "text-delta", id: "text", delta: answer.text },
            { type: "text-end", id: "text" },
          ]),
      ...answer.toolCalls.map((call) => ({
        type: "tool-call",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: JSON.stringify(call.arguments),
      })),
      {
        type: "finish",
        usage,
        finishReason: { unified: answer.toolCalls.length > 0 ? "tool-calls" : "stop", raw: undefined },
      },
    ];
  }
}

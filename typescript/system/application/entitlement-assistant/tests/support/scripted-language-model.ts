import type {
  ConversationMessage,
  LanguageModel,
  ModelStep,
  ToolDefinition,
} from "../../../../port/language-model.ts";

/** The scripted double of `LanguageModel` (spec: "the scripted double"): answers with the next scripted step. */
export class ScriptedLanguageModel implements LanguageModel {
  readonly requests: {
    readonly messages: readonly ConversationMessage[];
    readonly tools: readonly ToolDefinition[];
  }[] = [];
  #steps: ModelStep[] = [];

  /** Queues steps, answered in order; once they run out, every call answers the fallback reply. */
  script(...steps: readonly ModelStep[]): void {
    this.#steps.push(...steps);
  }

  readonly #fallbackReply: string;

  constructor(fallbackReply = "Noted.") {
    this.#fallbackReply = fallbackReply;
  }

  get calls(): number {
    return this.requests.length;
  }

  async respond(request: {
    readonly instructions: string;
    readonly messages: readonly ConversationMessage[];
    readonly tools: readonly ToolDefinition[];
  }): Promise<ModelStep> {
    this.requests.push({ messages: request.messages, tools: request.tools });
    return this.#steps.shift() ?? { text: this.#fallbackReply, toolCalls: [] };
  }
}

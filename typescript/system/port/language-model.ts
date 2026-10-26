/** One message of a case conversation, as the language model sees it. */
export type ConversationMessage =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string; readonly toolCalls: readonly ToolCall[] }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly result: unknown;
    };

export interface ToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  /** The arguments exactly as the model wrote them; validated by the tool, never trusted. */
  readonly arguments: unknown;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** One step of the model: text for the CSR, tool calls to run, or both. */
export interface ModelStep {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
}

/** The language model behind the case agent (Workers AI in production, a scripted double in tests). */
export interface LanguageModel {
  /**
   * Answers the conversation with one step.
   *
   * @ensures Every tool call names one of `tools`; its arguments are whatever the model wrote.
   * @ensures The model reads only what it is given: it has no other access to data or authority.
   */
  respond(request: {
    readonly instructions: string;
    readonly messages: readonly ConversationMessage[];
    readonly tools: readonly ToolDefinition[];
  }): Promise<ModelStep>;
}

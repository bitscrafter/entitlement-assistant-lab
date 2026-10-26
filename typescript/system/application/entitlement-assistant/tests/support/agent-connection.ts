import type { AgentConnection } from "../../src/agent/case-agent.ts";

/** Builds the Agents SDK chat request frame a browser sends for one user message. */
export function userMessageFrame(text: string, requestId = "request-1"): string {
  return JSON.stringify({
    type: "cf_agent_use_chat_request",
    id: requestId,
    init: {
      method: "POST",
      body: JSON.stringify({
        messages: [{ id: `${requestId}-message`, role: "user", parts: [{ type: "text", text }] }],
      }),
    },
  });
}

/** One parsed chunk of an assistant response (AI SDK UI message stream). */
type ResponseChunk = Readonly<Record<string, unknown>> & { readonly type: string };

/** A connection to a case agent that records every frame the agent sends and how it closed. */
export class TestConnection implements AgentConnection {
  readonly frames: string[] = [];
  closedWith: { readonly code: number; readonly reason: string } | null = null;

  readonly connectionId: string;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  send(frame: string): void {
    this.frames.push(frame);
  }

  close(code: number, reason: string): void {
    this.closedWith ??= { code, reason };
  }

  #chunks(): readonly ResponseChunk[] {
    return this.frames
      .map((frame) => JSON.parse(frame) as { type: string; body?: string })
      .filter(
        (frame) =>
          frame.type === "cf_agent_use_chat_response" && typeof frame.body === "string" && frame.body !== "",
      )
      .map((frame) => JSON.parse(frame.body ?? "{}") as ResponseChunk);
  }

  /** The assistant's text, concatenated across the stream. */
  replyText(): string {
    return this.#chunks()
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => String(chunk.delta ?? ""))
      .join("");
  }

  toolCalls(): readonly {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly input: unknown;
  }[] {
    return this.#chunks()
      .filter((chunk) => chunk.type === "tool-input-available")
      .map((chunk) => ({
        toolCallId: String(chunk.toolCallId),
        toolName: String(chunk.toolName),
        input: chunk.input,
      }));
  }

  toolOutputs(): readonly {
    readonly toolCallId: string;
    readonly output?: unknown;
    readonly errorText?: string;
  }[] {
    return this.#chunks()
      .filter((chunk) => chunk.type === "tool-output-available" || chunk.type === "tool-output-error")
      .map((chunk) =>
        chunk.type === "tool-output-available"
          ? { toolCallId: String(chunk.toolCallId), output: chunk.output }
          : { toolCallId: String(chunk.toolCallId), errorText: String(chunk.errorText) },
      );
  }
}

import type { RawWebSocket } from "./raw-websocket.ts";

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

/** One connection to a case agent, recording every frame the agent sends. */
export class AgentConversation {
  readonly frames: string[] = [];
  readonly socket: RawWebSocket;

  constructor(socket: RawWebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.frames.push(event.data));
  }

  get closedWith(): { readonly code: number; readonly reason: string } | null {
    return this.socket.closedWith;
  }

  send(frame: string): void {
    this.socket.send(frame);
  }

  /** Waits until the agent ends the turn of `requestId`, or closes the connection. */
  turnEnded(requestId: string): Promise<void> {
    return this.#until(
      () =>
        this.closedWith !== null ||
        this.frames.some((frame) => {
          const parsed = JSON.parse(frame) as { type?: string; id?: string; done?: boolean };
          return (
            parsed.type === "cf_agent_use_chat_response" && parsed.id === requestId && parsed.done === true
          );
        }),
    );
  }

  /** Waits until the agent closes the connection. */
  closed(): Promise<void> {
    return this.#until(() => this.closedWith !== null);
  }

  /** Waits a little, for what must not happen (no close, no reply). */
  settle(milliseconds = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  /** The assistant's text, concatenated across every reply. */
  replyText(): string {
    return this.#chunks()
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => String(chunk.delta ?? ""))
      .join("");
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

  async #until(condition: () => boolean, timeoutMilliseconds = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out after ${this.frames.length} frames`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

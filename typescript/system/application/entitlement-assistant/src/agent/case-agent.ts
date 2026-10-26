import type { Uuid } from "../../../../kernel/identifier.ts";

/** What the server keeps for one agent connection; the client can never write it (connection session). */
export interface ConnectionSession {
  readonly principalAccountId: Uuid;
  readonly sessionId: Uuid;
  /** The expiry of the session token the connection was opened with (D6). */
  readonly expiresAt: Date;
}

/** One open WebSocket of a case agent, as the agent sees it. */
export interface AgentConnection {
  readonly connectionId: string;
  send(frame: string): void;
  close(code: number, reason: string): void;
}

/**
 * The case agent: one per case, serving every connection to it. It speaks the Agents SDK chat protocol over
 * each connection, runs the model and the tools, and keeps the conversation server-side.
 */
export class CaseAgent {
  async connect(_connection: AgentConnection, _session: ConnectionSession): Promise<void> {}

  async receive(_connection: AgentConnection, _frame: string): Promise<void> {}

  disconnect(_connection: AgentConnection): void {}

  /** Closes every connection whose session token has expired (D6); the Durable Object's alarm calls it. */
  async alarm(): Promise<void> {}

  /** The next instant `alarm` must run, or null when no connection is open. */
  nextAlarmAt(): Date | null {
    return null;
  }
}

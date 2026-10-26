import type { Uuid } from "../../../kernel/identifier.ts";

/** Case WebSocket connections (case-lifecycle D7): the port that closes every open connection of a case's agent. */
export interface CaseWebSocketConnections {
  /** @ensures Every open connection of the case's agent is closed with `4404 case_unavailable`. */
  closeAll(caseId: Uuid): Promise<void>;
}

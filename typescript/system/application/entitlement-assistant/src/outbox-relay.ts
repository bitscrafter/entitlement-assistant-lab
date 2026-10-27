import type { Uuid } from "../../../kernel/identifier.ts";
import type { OutboxMessage } from "../../../port/transactional-outbox.ts";
import type { ApprovalProcess } from "./approval-process.ts";

/**
 * Delivers one approval-process message (grants-and-approvals D6): `start`, `decision`, or `terminate`.
 *
 * @ensures Resolves once the destination took the message; rejects otherwise, so the message stays undelivered.
 */
export async function deliverApprovalMessage(
  process: ApprovalProcess,
  message: OutboxMessage,
): Promise<void> {
  const approvalId = message.aggregateId as Uuid;
  switch (message.messageType) {
    case "start": {
      const expiresAt = new Date(String(message.payload.expires_at));
      if (Number.isNaN(expiresAt.getTime())) throw new Error("A start message has no deadline.");
      await process.start(approvalId, expiresAt);
      return;
    }
    case "decision":
      await process.deliverDecision(approvalId);
      return;
    case "terminate":
      await process.terminate(approvalId);
      return;
    default:
      throw new Error(`Unknown approval-process message ${message.messageType}.`);
  }
}

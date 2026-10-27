import type { Uuid } from "../../../kernel/identifier.ts";

/**
 * The durable process of one approval (grants-and-approvals D6, D9): it waits for the decision or the deadline,
 * then has the application apply or expire the change. A Cloudflare Workflow in the Worker; a recording double in
 * tests. It holds no rule: every wake runs a use case that re-reads and decides.
 */
export interface ApprovalProcess {
  /** @ensures An instance for the approval waits until `expiresAt`; one already started is left as it is. */
  start(approvalId: Uuid, expiresAt: Date): Promise<"Started" | "AlreadyStarted">;

  /** @ensures The approval's instance wakes to apply the decision; delivering twice changes nothing. */
  deliverDecision(approvalId: Uuid): Promise<void>;

  /** @ensures The approval's instance stops; stopping one that already ended changes nothing. */
  terminate(approvalId: Uuid): Promise<void>;
}

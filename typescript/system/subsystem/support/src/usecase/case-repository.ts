import type { Uuid } from "../../../../kernel/identifier.ts";

export interface CaseRepository {
  /**
   * Opens a case assigned to the opener.
   *
   * @ensures One open case without subject or contact, and its one current assignment to `openedBy`.
   */
  open(caseId: Uuid, assignmentId: Uuid, openedBy: Uuid, at: Date): Promise<void>;

  /** @ensures The current assignee of the case, null for a case that does not exist or has none. */
  currentAssignee(
    caseId: Uuid,
  ): Promise<{ readonly exists: boolean; readonly assigneeAccountId: Uuid | null }>;
}

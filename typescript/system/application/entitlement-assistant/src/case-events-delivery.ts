import type { Uuid } from "../../../kernel/identifier.ts";

/** Hands a case's new events to its agent right after an action commits (case-lifecycle D21). */
export interface CaseEventsDelivery {
  /** @ensures The case's agent appends the case's events it does not hold yet; a lost delivery is repaired later. */
  deliver(caseId: Uuid): Promise<void>;
}

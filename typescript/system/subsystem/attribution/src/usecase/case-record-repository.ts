import type { Uuid } from "../../../../kernel/identifier.ts";
import type { JsonObject } from "../../../../kernel/json.ts";

/** An audit record of a case, as other subsystems may read it back (attribution §2). */
export interface CaseRecord {
  readonly recordId: Uuid;
  readonly occurredAt: Date;
  readonly actorAccountId: Uuid | null;
  readonly actionKey: string;
  readonly outcome: "Allow" | "Deny" | "Conditional" | "Succeeded" | "Failed";
  readonly subjectAccountId: Uuid | null;
  readonly reasons: readonly string[];
  readonly detail: JsonObject;
}

export interface CaseRecordRepository {
  /** @ensures The case's records with one of `actionKeys`, in the chain's order. */
  recordsOfCase(caseId: Uuid, actionKeys: readonly string[]): Promise<readonly CaseRecord[]>;
}

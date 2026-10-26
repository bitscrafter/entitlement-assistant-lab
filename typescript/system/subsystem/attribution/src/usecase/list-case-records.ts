import type { Uuid } from "../../../../kernel/identifier.ts";
import type { CaseRecord, CaseRecordRepository } from "./case-record-repository.ts";

export type { CaseRecord };

/** A case's audit records of some actions, read back in the chain's order (case-lifecycle D21). */
export class ListCaseRecords {
  readonly #records: CaseRecordRepository;

  constructor(dependencies: { readonly records: CaseRecordRepository }) {
    this.#records = dependencies.records;
  }

  /** @ensures Every record of the case whose action is one of `actionKeys`, oldest first. */
  execute(caseId: Uuid, actionKeys: readonly string[]): Promise<readonly CaseRecord[]> {
    return this.#records.recordsOfCase(caseId, actionKeys);
  }
}

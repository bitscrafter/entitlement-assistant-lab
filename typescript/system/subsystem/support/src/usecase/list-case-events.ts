import type { Uuid } from "../../../../kernel/identifier.ts";
import type { GetInternalAccountNames } from "../../../account/src/usecase/get-internal-account-names.ts";
import type { ListCaseRecords } from "../../../attribution/src/usecase/list-case-records.ts";
import { caseEventLineOf, EVENT_ACTIONS } from "../model/case-event.ts";
import { authenticationExpiresAt } from "../model/contact-authentication.ts";
import type { CaseRepository } from "./case-repository.ts";

export interface CaseEvent {
  /** `evt_` and the audit record's id: an event is appended once (D21). */
  readonly id: string;
  readonly text: string;
}

/**
 * The case's events, derived from its audit records, the source of truth (case-lifecycle D21). Account names are the
 * ones each action kept in Support (its record holds only their id, AT-7; review R5-1), as stored when the action's
 * own decision let the CSR read them; nothing is read anew (review R4-2).
 */
export class ListCaseEvents {
  readonly #listCaseRecords: ListCaseRecords;
  readonly #getInternalAccountNames: GetInternalAccountNames;
  readonly #cases: CaseRepository;

  constructor(dependencies: {
    readonly listCaseRecords: ListCaseRecords;
    readonly getInternalAccountNames: GetInternalAccountNames;
    readonly cases: CaseRepository;
  }) {
    this.#listCaseRecords = dependencies.listCaseRecords;
    this.#getInternalAccountNames = dependencies.getInternalAccountNames;
    this.#cases = dependencies.cases;
  }

  /** @ensures One event per lifecycle record that has a line, oldest first; nothing is recorded by reading them. */
  async execute(caseId: Uuid): Promise<readonly CaseEvent[]> {
    const records = await this.#listCaseRecords.execute(caseId, EVENT_ACTIONS);
    const actors = await this.#getInternalAccountNames.execute(
      records.flatMap((record) => (record.actorAccountId === null ? [] : [record.actorAccountId])),
    );
    const nameIdOf = (detail: Readonly<Record<string, unknown>>) =>
      typeof detail.name_id === "string" ? (detail.name_id as Uuid) : null;
    const names = await this.#cases.accountNames(
      records.flatMap((record) => {
        const nameId = nameIdOf(record.detail);
        return nameId === null ? [] : [nameId];
      }),
    );
    const events: CaseEvent[] = [];
    for (const record of records) {
      const nameId = nameIdOf(record.detail);
      const text = caseEventLineOf(record, {
        actor: (record.actorAccountId === null ? undefined : actors.get(record.actorAccountId)) ?? "a CSR",
        account: nameId === null ? null : (names.get(nameId) ?? null),
        expiresAt: record.outcome === "Succeeded" ? authenticationExpiresAt(record.occurredAt) : null,
      });
      if (text !== null) events.push({ id: `evt_${record.recordId}`, text });
    }
    return events;
  }
}

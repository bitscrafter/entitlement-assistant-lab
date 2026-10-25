import type { SecurityEvent, SecurityEventLog } from "../../port/security-event-log.ts";

/** Keeps security events in memory, so tests can assert them. */
export class RecordingSecurityEventLog implements SecurityEventLog {
  readonly #events: SecurityEvent[] = [];

  record(event: SecurityEvent): void {
    this.#events.push(event);
  }

  get events(): readonly SecurityEvent[] {
    return [...this.#events];
  }
}

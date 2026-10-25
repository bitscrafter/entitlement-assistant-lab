import type { SecurityEvent, SecurityEventLog } from "../../port/security-event-log.ts";

/** Writes security events as structured log lines, collected by the platform's observability. */
export class ConsoleSecurityEventLog implements SecurityEventLog {
  record(event: SecurityEvent): void {
    console.warn(JSON.stringify({ log: "security-event", ...event }));
  }
}

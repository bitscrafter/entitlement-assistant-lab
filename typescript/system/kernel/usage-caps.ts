/**
 * The usage caps of a public demo (usage-guards D1): every cap derives from the daily AI neuron budget, so one
 * setting keeps the demo inside the included allowance (a rule, so in the kernel, CM-1).
 */
export interface UsageCaps {
  /** G1: model calls per UTC day, across every employee; 0 turns the assistant off (G4). */
  readonly modelCallsPerDay: number;
  /** G2: messages per employee per UTC day; null when the assistant is off, so the global cap answers instead. */
  readonly messagesPerEmployeePerDay: number | null;
}

/** The part of the day's model calls one employee may use (D3). */
export const EMPLOYEE_SHARE_OF_MODEL_CALLS = 0.4;

/**
 * @ensures `modelCallsPerDay` is ⌊neuronsPerDay ÷ neuronsPerModelCall⌋ (0 for a non-positive budget or estimate).
 * @ensures `messagesPerEmployeePerDay` is ⌊modelCallsPerDay × 40%⌋, at least 1, while the assistant is on; null when off.
 */
export function usageCapsOf(settings: {
  readonly neuronsPerDay: number;
  readonly neuronsPerModelCall: number;
}): UsageCaps {
  const modelCallsPerDay =
    settings.neuronsPerDay > 0 && settings.neuronsPerModelCall > 0
      ? Math.floor(settings.neuronsPerDay / settings.neuronsPerModelCall)
      : 0;
  return {
    modelCallsPerDay,
    messagesPerEmployeePerDay:
      modelCallsPerDay === 0
        ? null
        : Math.max(1, Math.floor(modelCallsPerDay * EMPLOYEE_SHARE_OF_MODEL_CALLS)),
  };
}

/** `2026-10-27` for any instant of that UTC day: the day a daily allowance counts in. */
export function utcDayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * One take from a daily allowance: the single rule every daily allowance adapter applies.
 *
 * @ensures A new UTC day starts at 0. `Refused`, uncounted, once `cap` were taken that day; otherwise counted.
 */
export function takeFromDay(
  counted: { readonly day: string; readonly taken: number } | undefined,
  at: Date,
  cap: number,
): {
  readonly outcome: "Allowed" | "Refused";
  readonly counted: { readonly day: string; readonly taken: number };
} {
  const day = utcDayOf(at);
  const taken = counted?.day === day ? counted.taken : 0;
  if (taken >= cap) return { outcome: "Refused", counted: { day, taken } };
  return { outcome: "Allowed", counted: { day, taken: taken + 1 } };
}

/** G5: sign-in attempts per IP address per minute (usage-guards D6). */
export const SIGN_IN_ATTEMPTS_PER_MINUTE = 10;

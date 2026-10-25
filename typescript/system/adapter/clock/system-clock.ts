import type { Clock } from "../../port/clock.ts";

/** The platform's clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

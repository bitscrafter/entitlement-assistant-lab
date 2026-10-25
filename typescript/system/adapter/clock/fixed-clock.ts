import type { Clock } from "../../port/clock.ts";

/** A clock that shows the instant it is set to; tests move it explicitly. */
export class FixedClock implements Clock {
  #instant: Date;

  constructor(instant: Date) {
    this.#instant = new Date(instant.getTime());
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }

  /** @ensures `now()` returns `instant` until the next call. */
  setTo(instant: Date): void {
    this.#instant = new Date(instant.getTime());
  }
}

/** The source of the current instant. Nothing below the application reads the system clock directly. */
export interface Clock {
  /** @ensures Returns the current instant, in UTC. */
  now(): Date;
}

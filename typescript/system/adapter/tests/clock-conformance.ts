import { expect, test } from "vitest";
import type { Clock } from "../../port/clock.ts";

/** What every Clock adapter guarantees. */
export function clockConformance(name: string, create: () => Clock): void {
  test(`${name} ensures now returns a valid instant`, () => {
    expect(Number.isNaN(create().now().getTime())).toBe(false);
  });

  test(`${name} ensures the returned instant cannot be mutated through the clock`, () => {
    const clock = create();
    const first = clock.now();
    first.setTime(0);
    expect(clock.now().getTime()).not.toBe(0);
  });
}

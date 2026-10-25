import { describe, expect, test } from "vitest";
import { FixedClock } from "../clock/fixed-clock.ts";
import { SystemClock } from "../clock/system-clock.ts";
import { clockConformance } from "./clock-conformance.ts";

describe("clocks", () => {
  clockConformance("SystemClock", () => new SystemClock());
  clockConformance("FixedClock", () => new FixedClock(new Date("2026-10-22T15:00:00Z")));

  test("FixedClock ensures now returns the instant it was set to", () => {
    const clock = new FixedClock(new Date("2026-10-22T15:00:00Z"));
    clock.setTo(new Date("2026-10-22T15:56:00Z"));
    expect(clock.now().toISOString()).toBe("2026-10-22T15:56:00.000Z");
  });
});

import { describe, expect, test } from "vitest";
import { takeFromDay, usageCapsOf } from "../usage-caps.ts";

describe("usageCapsOf (usage-guards UG6)", () => {
  test.each([
    [10_000, 100, { modelCallsPerDay: 100, messagesPerEmployeePerDay: 40 }],
    [1_000, 100, { modelCallsPerDay: 10, messagesPerEmployeePerDay: 4 }],
    [150, 100, { modelCallsPerDay: 1, messagesPerEmployeePerDay: 1 }],
    [0, 100, { modelCallsPerDay: 0, messagesPerEmployeePerDay: null }],
    [10_000, 0, { modelCallsPerDay: 0, messagesPerEmployeePerDay: null }],
  ])("ensures %d neurons at %d a call derive %o", (neuronsPerDay, neuronsPerModelCall, caps) => {
    expect(usageCapsOf({ neuronsPerDay, neuronsPerModelCall })).toEqual(caps);
  });
});

describe("takeFromDay (usage-guards D2, D3)", () => {
  const at = (instant: string) => new Date(instant);

  test("ensures takes are counted up to the cap, and a refused take is not counted", () => {
    let counted: { readonly day: string; readonly taken: number } | undefined;
    const outcomes = [];
    for (let take = 0; take < 3; take += 1) {
      const result = takeFromDay(counted, at("2026-10-27T10:00:00Z"), 2);
      outcomes.push(result.outcome);
      counted = result.counted;
    }
    expect(outcomes).toEqual(["Allowed", "Allowed", "Refused"]);
    expect(counted).toEqual({ day: "2026-10-27", taken: 2 });
  });

  test("ensures a new UTC day starts at zero", () => {
    const yesterday = { day: "2026-10-27", taken: 2 };
    expect(takeFromDay(yesterday, at("2026-10-28T00:00:00Z"), 2)).toEqual({
      outcome: "Allowed",
      counted: { day: "2026-10-28", taken: 1 },
    });
  });

  test("ensures a cap of zero refuses everything", () => {
    expect(takeFromDay(undefined, at("2026-10-27T10:00:00Z"), 0).outcome).toBe("Refused");
  });
});

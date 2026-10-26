import { expect, test } from "vitest";
import type { Uuid } from "../../kernel/identifier.ts";
import type { MessageRateLimiter } from "../../port/message-rate-limiter.ts";

const ALEX = "0199a1b2-0000-7000-8000-0000000a1e00" as Uuid;
const BLAIR = "0199a1b2-0000-7000-8000-0000000b1a00" as Uuid;
const START = Date.parse("2026-10-22T15:00:00Z");
const at = (milliseconds: number) => new Date(START + milliseconds);

/** The contract every `MessageRateLimiter` adapter passes (D13: 20 per sliding minute per account). */
export function messageRateLimiterConformance(create: () => MessageRateLimiter): void {
  test("ensures 20 messages within a minute are allowed and the 21st refused", async () => {
    const limiter = create();
    for (let index = 0; index < 20; index += 1)
      expect(await limiter.attempt(ALEX, at(index * 1000))).toBe("Allowed");
    expect(await limiter.attempt(ALEX, at(40_000))).toBe("Refused");
  });

  test("ensures the window slides: an attempt is allowed again once the oldest leaves the minute", async () => {
    const limiter = create();
    for (let index = 0; index < 20; index += 1) await limiter.attempt(ALEX, at(index * 1000));
    expect(await limiter.attempt(ALEX, at(59_999))).toBe("Refused");
    expect(await limiter.attempt(ALEX, at(60_000))).toBe("Allowed");
  });

  test("ensures a refused attempt is not counted", async () => {
    const limiter = create();
    for (let index = 0; index < 20; index += 1) await limiter.attempt(ALEX, at(0));
    for (let index = 0; index < 5; index += 1)
      expect(await limiter.attempt(ALEX, at(30_000))).toBe("Refused");
    expect(await limiter.attempt(ALEX, at(60_001))).toBe("Allowed");
  });

  test("ensures each account has its own count", async () => {
    const limiter = create();
    for (let index = 0; index < 20; index += 1) await limiter.attempt(ALEX, at(0));
    expect(await limiter.attempt(BLAIR, at(1))).toBe("Allowed");
  });
}

import { describe, expect, test } from "vitest";
import {
  DAILY_ALLOWANCE_TEXT,
  dailyAllowanceMiddleware,
  latestConversation,
} from "../../src/agent/usage-bounds.ts";

describe("latestConversation (usage-guards D4)", () => {
  const conversation = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: index,
      role: index % 2 === 0 ? "user" : "assistant",
    }));

  test("ensures a conversation of 30 messages reaches the model as its latest 20", () => {
    const latest = latestConversation(conversation(30));
    expect(latest).toHaveLength(20);
    expect(latest[0]).toEqual({ id: 10, role: "user" });
    expect(latest.at(-1)).toEqual({ id: 29, role: "assistant" });
  });

  test("ensures the window starts at a user message and leaves system messages out", () => {
    const messages = [
      { id: "a", role: "assistant" },
      { id: "s", role: "system" },
      { id: "u", role: "user" },
      { id: "b", role: "assistant" },
    ];
    expect(latestConversation(messages, 3)).toEqual([
      { id: "u", role: "user" },
      { id: "b", role: "assistant" },
    ]);
  });
});

describe("dailyAllowanceMiddleware (usage-guards D2)", () => {
  test("ensures a refused take never calls the provider", async () => {
    let called = 0;
    const middleware = dailyAllowanceMiddleware(async () => "Refused");
    await expect(
      middleware.wrapStream({
        doStream: async () => {
          called += 1;
          return "stream";
        },
      }),
    ).rejects.toThrow(DAILY_ALLOWANCE_TEXT);
    expect(called).toBe(0);
  });

  test("ensures an allowed take calls the provider once", async () => {
    const middleware = dailyAllowanceMiddleware(async () => "Allowed");
    expect(await middleware.wrapGenerate({ doGenerate: async () => "answer" })).toBe("answer");
  });
});

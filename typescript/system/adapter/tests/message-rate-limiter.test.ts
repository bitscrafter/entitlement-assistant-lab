import { describe } from "vitest";
import { InMemoryMessageRateLimiter } from "../message-rate-limiter/in-memory-message-rate-limiter.ts";
import { messageRateLimiterConformance } from "./message-rate-limiter-conformance.ts";

describe("InMemoryMessageRateLimiter", () => {
  messageRateLimiterConformance(() => new InMemoryMessageRateLimiter());
});

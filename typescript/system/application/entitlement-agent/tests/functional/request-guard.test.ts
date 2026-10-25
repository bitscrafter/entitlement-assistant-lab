import { describe, expect, test } from "vitest";
import { originAllowed } from "../../src/http/request-guard.ts";

const ORIGIN = "https://app.entitlement-agent.example";
const request = (method: string, origin?: string) =>
  new Request(`${ORIGIN}/api/x`, { method, headers: origin === undefined ? {} : { Origin: origin } });

describe("originAllowed", () => {
  test("ensures a GET needs no origin", () => {
    expect(originAllowed(request("GET"), ORIGIN)).toBe(true);
  });

  test.each(["POST", "PUT", "DELETE", "PATCH"])(
    "ensures a %s with the application's origin is allowed",
    (method) => {
      expect(originAllowed(request(method, ORIGIN), ORIGIN)).toBe(true);
    },
  );

  test.each([
    ["no origin", undefined],
    ["another site", "https://attacker.example"],
    ["a subdomain", "https://evil.app.entitlement-agent.example"],
    ["plain HTTP", "http://app.entitlement-agent.example"],
    ["a null origin", "null"],
  ])("ensures a POST from %s is refused", (_name, origin) => {
    expect(originAllowed(request("POST", origin), ORIGIN)).toBe(false);
  });
});

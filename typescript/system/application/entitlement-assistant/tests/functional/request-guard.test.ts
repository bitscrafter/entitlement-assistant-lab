import { describe, expect, test } from "vitest";
import { httpsRedirect, originAllowed, servedByApplication } from "../../src/http/request-guard.ts";

const ORIGIN = "https://app.entitlement-assistant.example";
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
    ["a subdomain", "https://evil.app.entitlement-assistant.example"],
    ["plain HTTP", "http://app.entitlement-assistant.example"],
    ["a null origin", "null"],
  ])("ensures a POST from %s is refused", (_name, origin) => {
    expect(originAllowed(request("POST", origin), ORIGIN)).toBe(false);
  });
});

describe("httpsRedirect", () => {
  test("ensures a plain-HTTP request to an HTTPS application is redirected with 308 to the same path and query", () => {
    const redirect = httpsRedirect(
      new Request("http://app.entitlement-assistant.example/cases?open=1"),
      ORIGIN,
    );
    expect(redirect?.status).toBe(308);
    expect(redirect?.headers.get("location")).toBe(`${ORIGIN}/cases?open=1`);
  });

  test("ensures the redirect target is the application's origin, never the request's host", () => {
    const redirect = httpsRedirect(new Request("http://attacker.example/sign-in"), ORIGIN);
    expect(redirect?.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
  });

  test.each([
    ["an HTTPS request", "https://app.entitlement-assistant.example/", ORIGIN],
    ["a local plain-HTTP application", "http://localhost:8787/", "http://localhost:8787"],
  ])("ensures %s is not redirected", (_name, url, applicationOrigin) => {
    expect(httpsRedirect(new Request(url), applicationOrigin)).toBeUndefined();
  });
});

describe("servedByApplication", () => {
  test.each(["/api/authentication/sign-in", "/api/", "/agents/case/1"])(
    "ensures %s is served by the application",
    (path) => {
      expect(servedByApplication(path)).toBe(true);
    },
  );

  test.each(["/", "/index.html", "/assets/index.js", "/api", "/apix/y", "/agentsx"])(
    "ensures %s is served as a static asset",
    (path) => {
      expect(servedByApplication(path)).toBe(false);
    },
  );
});

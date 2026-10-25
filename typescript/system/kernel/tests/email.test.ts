import { describe, expect, test } from "vitest";
import { normalizeEmail } from "../email.ts";

describe("normalizeEmail", () => {
  test("ensures whitespace is trimmed and letters are lowercase", () => {
    expect(normalizeEmail("  Alex@Provider.Example ")).toBe("alex@provider.example");
  });

  test("ensures the domain is ASCII (punycode)", () => {
    expect(normalizeEmail("ana@bücher.example")).toBe("ana@xn--bcher-kva.example");
  });

  test("ensures Unicode is in NFC", () => {
    expect(normalizeEmail("josé@provider.example")).toBe("josé@provider.example");
  });

  test("ensures no provider-specific rewriting", () => {
    expect(normalizeEmail("first.last+tag@provider.example")).toBe("first.last+tag@provider.example");
  });

  test("ensures text that is not an address stays unmatched", () => {
    expect(normalizeEmail("not-an-address")).toBe("not-an-address");
  });
});

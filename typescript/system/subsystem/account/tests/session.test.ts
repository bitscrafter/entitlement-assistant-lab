import { describe, expect, test } from "vitest";
import { decideRenewal } from "../src/model/session.ts";

const at = (time: string) => new Date(`2026-10-22T${time}Z`);
const token = (iat: string, exp: string) => ({
  authenticatedAt: at("08:00:00"),
  issuedAt: at(iat),
  expiresAt: at(exp),
});

describe("decideRenewal", () => {
  test("ensures no change before the midpoint of the token's lifetime", () => {
    expect(decideRenewal(token("14:50:00", "15:20:00"), at("15:04:59"))).toEqual({ kind: "NoChange" });
  });

  test("ensures a renewal from the midpoint on", () => {
    expect(decideRenewal(token("14:50:00", "15:20:00"), at("15:05:00"))).toEqual({
      kind: "Renew",
      expiresAt: at("15:35:00"),
    });
  });

  test("ensures a renewed token never ends after the absolute lifetime", () => {
    expect(decideRenewal(token("15:20:00", "15:50:00"), at("15:40:00"))).toEqual({
      kind: "Renew",
      expiresAt: at("16:00:00"),
    });
  });

  test("ensures a token already ending at the absolute lifetime is refused", () => {
    expect(decideRenewal(token("15:40:00", "16:00:00"), at("15:55:00"))).toEqual({
      kind: "RefuseAtAbsoluteLifetime",
    });
  });
});

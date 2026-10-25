import { describe, expect, test } from "vitest";
import { decodeIdentifier, encodeIdentifier, parseUuid, type Uuid } from "../identifier.ts";

const uuid = "01928f3a-7b5c-7d2e-9f10-a1b2c3d4e5f6" as Uuid;

describe("identifier", () => {
  test("ensures an encoded identifier is the prefix, an underscore, and 22 characters", () => {
    expect(encodeIdentifier("acc", uuid)).toMatch(/^acc_[A-Za-z0-9_-]{22}$/);
  });

  test("ensures decoding an encoded identifier returns the UUID", () => {
    expect(decodeIdentifier("acc", encodeIdentifier("acc", uuid))).toEqual({ ok: true, value: uuid });
  });

  test("ensures a well-formed identifier with another prefix is malformed", () => {
    expect(decodeIdentifier("iac", encodeIdentifier("acc", uuid))).toEqual({
      ok: false,
      failure: "MalformedIdentifier",
    });
  });

  test("ensures only the canonical spelling is accepted", () => {
    // The last character carries 2 bits of the UUID and 4 spare bits; setting a spare bit gives a second
    // spelling of the same 16 bytes, which must be rejected.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const encoded = encodeIdentifier("acc", uuid);
    const lastValue = alphabet.indexOf(encoded.at(-1) ?? "");
    const alternative = `${encoded.slice(0, -1)}${alphabet.charAt(lastValue + 1)}`;
    expect(decodeIdentifier("acc", alternative).ok).toBe(false);
  });

  test.each(["acc_", "acc_short", "acc_!!!!!!!!!!!!!!!!!!!!!!", "acc_AAAAAAAAAAAAAAAAAAAAAAA"])(
    "ensures malformed text %s is rejected",
    (text) => {
      expect(decodeIdentifier("acc", text).ok).toBe(false);
    },
  );

  test("ensures a parsed UUID is lowercase", () => {
    expect(parseUuid(uuid.toUpperCase())).toEqual({ ok: true, value: uuid });
  });

  test("ensures non-UUID text is rejected", () => {
    expect(parseUuid("not-a-uuid").ok).toBe(false);
  });
});

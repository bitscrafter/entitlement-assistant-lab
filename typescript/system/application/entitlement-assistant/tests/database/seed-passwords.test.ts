import { describe, expect, test } from "vitest";
import {
  createSeedPassword,
  formatSeedPasswords,
  isLocalDatabase,
  parseSeedPasswords,
} from "../../src/database/seed-passwords.ts";

const cryptoRandom = (length: number) => crypto.getRandomValues(new Uint8Array(length));

describe("isLocalDatabase", () => {
  test("ensures true exactly when the host is localhost, 127.0.0.1, or ::1", () => {
    expect(isLocalDatabase("postgres://user:secret@localhost:54329/database")).toBe(true);
    expect(isLocalDatabase("postgres://user:secret@127.0.0.1/database")).toBe(true);
    expect(isLocalDatabase("postgres://user:secret@[::1]:5432/database")).toBe(true);
    expect(isLocalDatabase("postgres://user:secret@ep-name.eu-central-1.aws.neon.tech/database")).toBe(false);
    expect(isLocalDatabase("postgres://user:secret@localhost.example/database")).toBe(false);
  });
});

describe("createSeedPassword", () => {
  test("ensures the lowercase given name followed by three groups of four readable characters", () => {
    for (let run = 0; run < 50; run += 1) {
      expect(createSeedPassword("Alex", cryptoRandom)).toMatch(
        /^alex-[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/,
      );
    }
  });

  test("ensures each random character is drawn uniformly: bytes at or above 248 (31 × 8) are skipped", () => {
    const calls = [
      [248, 249, 250, 251, 252, 253, 254, 255, 0, 1, 2, 3],
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    ];
    const scriptedRandom = (length: number) =>
      Uint8Array.from(calls.shift() ?? [], (byte) => byte).slice(0, length);
    expect(createSeedPassword("x", scriptedRandom)).toBe("x-2345-6789-abcd");
    const wrapped = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42];
    expect(createSeedPassword("x", () => Uint8Array.from(wrapped))).toBe("x-2345-6789-abcd");
  });
});

describe("parseSeedPasswords", () => {
  test("ensures parse(format(passwords)) equals passwords", () => {
    const passwords = new Map([
      ["alex@provider.example", "alex-k7m2-x9qp-4hdr"],
      ["blair@provider.example", "blair-has=equals"],
    ]);
    expect(parseSeedPasswords(formatSeedPasswords(passwords))).toEqual(passwords);
  });

  test("ensures blank lines and comments are skipped and each line splits at its first =", () => {
    expect(parseSeedPasswords("# demo\n\n alex@provider.example=a=b \n")).toEqual(
      new Map([["alex@provider.example", "a=b"]]),
    );
  });

  test.each([
    ["no separator", "alex@provider.example"],
    ["empty email", "=password"],
    ["empty password", "alex@provider.example="],
    ["repeated email", "alex@provider.example=one\nalex@provider.example=two"],
  ])("ensures a line with %s is rejected with its line number", (_, text) => {
    expect(() => parseSeedPasswords(text)).toThrow(/line \d+/);
  });
});

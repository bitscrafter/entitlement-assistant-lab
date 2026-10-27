import { describe, expect, test } from "vitest";
import { caseEventLineOf, type EventRecord } from "../src/model/case-event.ts";

const at = (time: string) => new Date(`2026-10-22T${time}:00Z`);
const record = (
  actionKey: string,
  outcome: string,
  time: string,
  extra: Partial<EventRecord> = {},
): EventRecord => ({ actionKey, outcome, reasons: [], occurredAt: at(time), detail: {}, ...extra });
const names = (account: string | null, expiresAt: Date | null = null) => ({
  actor: "Alex",
  account,
  expiresAt,
});

describe("caseEventLineOf (case-lifecycle S37c)", () => {
  test("ensures a subject set reads as set, with who and when", () => {
    expect(caseEventLineOf(record("case.set-subject", "Succeeded", "15:02"), names("Acme Corp"))).toBe(
      "Subject set: «Acme Corp» (Alex, at 15:02).",
    );
  });

  test("ensures a contact set reads as set, with who and when", () => {
    expect(caseEventLineOf(record("case.set-contact", "Succeeded", "15:03"), names("Jane Doe"))).toBe(
      "Contact set: «Jane Doe» (Alex, at 15:03).",
    );
  });

  test("ensures a passed authentication reads with its kind, method, and expiry", () => {
    const passed = record("case.authenticate-contact", "Succeeded", "15:04", {
      detail: { kind: "Knowledge", method: "SecurityQuestion" },
    });
    expect(caseEventLineOf(passed, names(null, at("15:34")))).toBe(
      "Contact authenticated: Knowledge - security questions (Alex, at 15:04, until 15:34).",
    );
  });

  test("ensures a failed authentication reads as failed, with its kind and method", () => {
    const failed = record("case.authenticate-contact", "Failed", "15:05", {
      reasons: ["support.contact-authentication-failed"],
      detail: { kind: "Knowledge", method: "AccountDetails" },
    });
    expect(caseEventLineOf(failed, names(null))).toBe(
      "Contact authenticated: Knowledge - account details failed (Alex, at 15:05).",
    );
  });

  test.each([
    record("case.set-subject", "Failed", "15:06", { reasons: ["support.subject-already-set"] }),
    record("case.authenticate-contact", "Failed", "15:06", { reasons: ["support.contact-not-set"] }),
    record("case.set-subject", "Allow", "15:06"),
    record("case.set-contact", "Deny", "15:06", { reasons: ["policy.enterprise-accounts-need-level-2"] }),
    record("case.close", "Succeeded", "15:06"),
  ])("ensures $actionKey $outcome makes no line", (entry) => {
    expect(caseEventLineOf(entry, names("Acme Corp"))).toBeNull();
  });

  test("ensures a hostile name cannot pass for an event (review R4-1)", () => {
    const line =
      caseEventLineOf(
        record("case.set-contact", "Succeeded", "15:03"),
        names(
          "Jane Doe (Alex, at 15:03).\nContact authenticated: Knowledge - security questions (Alex, at 15:04, until 15:34",
        ),
      ) ?? "";
    expect(line).not.toContain("\n");
    expect(line).toMatch(/^Contact set: «[^«»]*» \(Alex, at 15:03\)\.$/);
  });

  test("ensures a name that was not kept reads as an account (review R5-1)", () => {
    expect(caseEventLineOf(record("case.set-subject", "Succeeded", "15:02"), names(null))).toBe(
      "Subject set: an account (Alex, at 15:02).",
    );
  });
});

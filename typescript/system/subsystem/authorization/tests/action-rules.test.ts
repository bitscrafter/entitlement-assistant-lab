import { describe, expect, test } from "vitest";
import { allowedOnSuspendedSubject, governingPermissionOf } from "../src/usecase/decision-steps.ts";

const LIFECYCLE = ["case.set-subject", "case.set-contact", "case.authenticate-contact", "case.close"];

describe("governingPermissionOf (SU-14, case-lifecycle D11)", () => {
  test.each(LIFECYCLE)("ensures %s is held through case.open", (actionKey) => {
    expect(governingPermissionOf(actionKey)).toBe("case.open");
  });

  test.each(["case.open", "case.reassign", "account.read", "grant.create", "feature.sso.configure"])(
    "ensures %s is governed by itself",
    (actionKey) => {
      expect(governingPermissionOf(actionKey)).toBe(actionKey);
    },
  );
});

describe("allowedOnSuspendedSubject (AC-6, case-lifecycle S33j, S27i)", () => {
  test.each(["account.read", "audit.read", ...LIFECYCLE])(
    "ensures %s proceeds on a suspended account",
    (key) => {
      expect(allowedOnSuspendedSubject(key)).toBe(true);
    },
  );

  test.each(["grant.create", "subscription.change-plan", "feature.sso.configure", "case.reassign"])(
    "ensures %s stops on a suspended account",
    (key) => {
      expect(allowedOnSuspendedSubject(key)).toBe(false);
    },
  );
});

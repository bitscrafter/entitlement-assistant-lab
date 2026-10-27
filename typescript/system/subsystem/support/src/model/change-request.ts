import type { Uuid } from "../../../../kernel/identifier.ts";

export type ChangeKind = "CreateGrant" | "RevokeGrant" | "ExtendGrant";

export type ChangeStatus =
  | "AwaitingConfirmation"
  | "AwaitingApproval"
  | "Applied"
  | "Refused"
  | "Canceled"
  | "Expired";

export type ApprovalStatus = "Pending" | "Approved" | "Denied" | "Expired" | "Canceled";

export type DenialReason = "PolicyLimit" | "InsufficientJustification" | "CustomerNotEligible" | "Other";

/** A change as a preparing tool asks for it (grants-and-approvals D1). */
export type ChangeAsked =
  | {
      readonly kind: "CreateGrant";
      readonly featureKey: string;
      readonly quota?: number;
      readonly durationDays: number;
      readonly reason: string;
    }
  | { readonly kind: "RevokeGrant"; readonly grantId: Uuid; readonly reason: string }
  | {
      readonly kind: "ExtendGrant";
      readonly grantId: Uuid;
      readonly durationDays: number;
      readonly reason: string;
    };

/** The action a change kind is decided as (D3, D12, D13): an extension is a grant like any other. */
export function actionKeyOf(kind: ChangeKind): "grant.create" | "grant.revoke" {
  return kind === "RevokeGrant" ? "grant.revoke" : "grant.create";
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** @ensures The instant `days` whole days after `from`. */
export function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MILLISECONDS);
}

/**
 * The window a grant change would grant if applied at `at` (D5, D13).
 *
 * @ensures A new grant: from `at` for its days. An extension: from `at` to the extended grant's expiry plus its days.
 *          A revocation grants nothing: null.
 */
export function grantWindowOf(
  change: ChangeAsked,
  at: Date,
  extendedGrantExpiresAt: Date | null,
): { readonly startsAt: Date; readonly endsAt: Date } | null {
  switch (change.kind) {
    case "CreateGrant":
      return { startsAt: at, endsAt: daysAfter(at, change.durationDays) };
    case "ExtendGrant":
      if (extendedGrantExpiresAt === null) throw new Error("An extension's window needs the grant's expiry.");
      return { startsAt: at, endsAt: daysAfter(extendedGrantExpiresAt, change.durationDays) };
    case "RevokeGrant":
      return null;
  }
}

/** The 72 hours an approval waits for a decision (D9), unless the deployment says otherwise. */
export const DEFAULT_APPROVAL_WINDOW_MILLISECONDS = 72 * 60 * 60 * 1000;

import type { Uuid } from "../../../../kernel/identifier.ts";

export type {
  EntitlementSource,
  Quota,
  ReasonFacts,
} from "../../../entitlement/src/usecase/compute-effective-entitlements.ts";

/** Who asks, and where: every value comes from the verified session or the connection, never from the model. */
export interface ReadRequest {
  readonly principalAccountId: Uuid;
  readonly sessionId: Uuid | null;
  readonly caseId: Uuid | null;
  /** The tool call that asked, recorded in the audit record's detail; null outside a chat turn. */
  readonly toolCallId: string | null;
  readonly traceId: string;
}

/** A read of another account than the case's subject (case-lifecycle D6): refused before anything is decided. */
export interface NotCaseSubject {
  readonly kind: "NotCaseSubject";
}

/** Refusals of a read (AU-6, explain-access D3). */
export type ReadRefusal =
  | { readonly kind: "NotFound" }
  | { readonly kind: "Denied"; readonly reasonCodes: readonly string[] };

export interface CoveringTerm {
  readonly planKey?: string;
  readonly source: string;
  /** The term's effective end; null when open-ended. */
  readonly endsAt: Date | null;
}

/** The subject account a read is about, as a CSR recognizes it: its name, plan, and covering term. */
export interface AccountContext {
  readonly accountId: Uuid;
  readonly displayName: string;
  /** The plan of the latest term, current or ended; null when the account never had a term. */
  readonly planKey: string | null;
  readonly coveringTerm: CoveringTerm | null;
}

/** @ensures The account context of a computed subject: its effective covering term, or none when nothing is effective. */
export function accountContextOf(computed: {
  readonly account: { readonly accountId: Uuid; readonly displayName: string };
  readonly latestPlanKey: string | null;
  readonly effective:
    | { readonly kind: "Effective"; readonly coveringTerm: CoveringTerm }
    | { readonly kind: "None" };
}): AccountContext {
  return {
    accountId: computed.account.accountId,
    displayName: computed.account.displayName,
    planKey: computed.latestPlanKey,
    coveringTerm: computed.effective.kind === "Effective" ? computed.effective.coveringTerm : null,
  };
}

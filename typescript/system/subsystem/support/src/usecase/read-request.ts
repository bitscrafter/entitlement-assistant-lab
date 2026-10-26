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

/** Refusals of a read (AU-6, explain-access D3). */
export type ReadRefusal =
  | { readonly kind: "NotFound" }
  | { readonly kind: "Denied"; readonly reasonCodes: readonly string[] };

export interface CoveringTerm {
  readonly source: string;
  /** The term's effective end; null when open-ended. */
  readonly endsAt: Date | null;
}

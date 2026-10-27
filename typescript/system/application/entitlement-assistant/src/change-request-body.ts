import { encodeIdentifier, type Uuid } from "../../../kernel/identifier.ts";
import type { DiffOperation } from "../../../subsystem/entitlement/src/usecase/entitlement-diffs.ts";
import type { ChangeAsked } from "../../../subsystem/support/src/model/change-request.ts";

/** A change's parameters as the API shows them (api.md §6, §9): snake_case, grants by their external id. */
export function parametersBody(change: ChangeAsked): Record<string, unknown> {
  switch (change.kind) {
    case "CreateGrant":
      return {
        feature_key: change.featureKey,
        ...(change.quota === undefined ? {} : { quota: change.quota }),
        duration_days: change.durationDays,
        reason: change.reason,
      };
    case "RevokeGrant":
      return { grant_id: encodeIdentifier("grt", change.grantId), reason: change.reason };
    case "ExtendGrant":
      return {
        grant_id: encodeIdentifier("grt", change.grantId),
        duration_days: change.durationDays,
        reason: change.reason,
      };
  }
}

/** An entitlement diff as the API shows it: a grant source by its external id (`grant:grt_…`), the new one `grant:new`. */
export function diffBody(diff: readonly DiffOperation[]): unknown[] {
  const source = (name: string) =>
    /^grant:[0-9a-f-]{36}$/.test(name) ? `grant:${encodeIdentifier("grt", name.slice(6) as Uuid)}` : name;
  return diff.map((operation) =>
    operation.op === "remove"
      ? operation
      : { ...operation, value: { ...operation.value, sources: operation.value.sources.map(source) } },
  );
}

/** A decision's reasons as a CSR reads them: each code with its description (D2, D17). */
export function reasonsBody(
  reasonCodes: readonly string[],
  describeReason: (code: string) => string,
): { readonly code: string; readonly description: string }[] {
  return reasonCodes.map((code) => ({ code, description: describeReason(code) }));
}

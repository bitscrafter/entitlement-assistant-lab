import type { EntitlementSource, Quota } from "../../../../kernel/entitlement.ts";
import type { EffectiveEntitlements } from "./effective-entitlements.ts";

/** One feature of the effective-entitlements document: its quota and its sources, as `kind:key` strings. */
export interface DocumentEntitlement {
  readonly quota: Quota;
  readonly sources: readonly string[];
}

/** The effective entitlements as a JSON document, keyed by feature (the entitlement diff's document, SU-4). */
export type EntitlementDocument = Readonly<Record<string, DocumentEntitlement>>;

/** An RFC 6902 operation over the document; `test` operations hold the values the change was prepared on. */
export type DiffOperation =
  | { readonly op: "test"; readonly path: string; readonly value: DocumentEntitlement }
  | { readonly op: "add"; readonly path: string; readonly value: DocumentEntitlement }
  | { readonly op: "replace"; readonly path: string; readonly value: DocumentEntitlement }
  | { readonly op: "remove"; readonly path: string };

/** The source of a grant not created yet, as the diff of a prepared change names it. */
export const NEW_GRANT_SOURCE = "grant:new";

export function sourceName(source: EntitlementSource): string {
  switch (source.kind) {
    case "plan":
      return `plan:${source.planKey}`;
    case "addon":
      return `addon:${source.addonKey}`;
    case "grant":
      return `grant:${source.grantId}`;
  }
}

/** @ensures The document of the effective entitlements; empty when the account has none. */
export function entitlementDocument(
  effective: EffectiveEntitlements,
  renameSource: (name: string) => string = (name) => name,
): EntitlementDocument {
  if (effective.kind === "None") return {};
  return Object.fromEntries(
    effective.entitlements.map((entitlement) => [
      entitlement.featureKey,
      {
        quota: entitlement.quota,
        sources: entitlement.sources.map((source) => renameSource(sourceName(source))),
      },
    ]),
  );
}

/** JSON Pointer escaping of one path segment (RFC 6901). */
const pathOf = (featureKey: string) => `/${featureKey.replace(/~/g, "~0").replace(/\//g, "~1")}`;

const same = (left: DocumentEntitlement, right: DocumentEntitlement) =>
  left.quota === right.quota &&
  left.sources.length === right.sources.length &&
  left.sources.every((source, index) => source === right.sources[index]);

/**
 * The entitlement diff of a change (SU-4): what the change does to the document, by feature key.
 *
 * @ensures For each feature whose entry differs: a `test` of its value before (when it had one), then `add`,
 *          `replace`, or `remove`. Features are in key order. Nothing for an unchanged document.
 */
export function entitlementDiff(
  before: EntitlementDocument,
  after: EntitlementDocument,
): readonly DiffOperation[] {
  const operations: DiffOperation[] = [];
  for (const featureKey of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const path = pathOf(featureKey);
    const was = before[featureKey];
    const becomes = after[featureKey];
    if (was !== undefined && becomes !== undefined && same(was, becomes)) continue;
    if (was !== undefined) operations.push({ op: "test", path, value: was });
    if (becomes === undefined) operations.push({ op: "remove", path });
    else operations.push({ op: was === undefined ? "add" : "replace", path, value: becomes });
  }
  return operations;
}

/**
 * Whether a diff still applies to the document now (grants-and-approvals D8).
 *
 * @ensures True exactly when every `test` holds and every `add` targets a feature the document lacks.
 */
export function diffHolds(diff: readonly DiffOperation[], current: EntitlementDocument): boolean {
  return diff.every((operation) => {
    const entry = current[operation.path.slice(1).replace(/~1/g, "/").replace(/~0/g, "~")];
    if (operation.op === "test") return entry !== undefined && same(entry, operation.value);
    if (operation.op === "add") return entry === undefined;
    return true;
  });
}

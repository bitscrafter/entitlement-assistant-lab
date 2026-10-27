import { canonicalJson } from "../../../../external/canonical-json.ts";
import { parseYaml } from "../../../../external/yaml.ts";
import { z } from "../../../../external/zod.ts";
import { toBase64Url } from "../../../../kernel/identifier.ts";
import type { Policy, PolicySet } from "../model/policy.ts";

const prerequisite = z.strictObject({
  prerequisite_kind: z.literal("Approval"),
  fulfilled_by_permission: z.string(),
});

/** A policy file (policy §2), in block-style YAML with snake_case keys. */
const policyFile = z.strictObject({
  policy_key: z.string(),
  description: z.string().min(1),
  governed_actions: z.array(z.string()).min(1),
  applies_when: z.string().min(1).default("true"),
  requires: z.string().min(1),
  unmet_outcome: z.enum(["Deny", "Conditional"]),
  prerequisites: z.array(prerequisite).default([]),
});

const policySchema = z.strictObject({
  policyKey: z.string(),
  description: z.string(),
  governedActions: z.array(z.string()),
  appliesWhen: z.string(),
  requires: z.string(),
  unmetOutcome: z.enum(["Deny", "Conditional"]),
  prerequisites: z.array(
    z.strictObject({ prerequisiteKind: z.literal("Approval"), fulfilledByPermission: z.string() }),
  ),
});

const bundledSet = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  policies: z.array(policySchema),
});

/**
 * Reads one policy file.
 *
 * @ensures The file's policy; a file with an unknown or missing field rejects.
 */
export function parsePolicyFile(text: string): Policy {
  const file = policyFile.parse(parseYaml(text));
  return {
    policyKey: file.policy_key,
    description: file.description,
    governedActions: file.governed_actions,
    appliesWhen: file.applies_when,
    requires: file.requires,
    unmetOutcome: file.unmet_outcome,
    prerequisites: file.prerequisites.map((item) => ({
      prerequisiteKind: item.prerequisite_kind,
      fulfilledByPermission: item.fulfilled_by_permission,
    })),
  };
}

/**
 * The set of the policies, versioned by its content (policy §1).
 *
 * @ensures Policies are ordered by key; the version is the SHA-256 of their RFC 8785 canonical JSON, as unpadded
 *          base64url (CM-14), so the same policies always give the same version, in any order.
 */
export async function policySetOf(policies: readonly Policy[]): Promise<PolicySet> {
  const ordered = [...policies].sort((left, right) => left.policyKey.localeCompare(right.policyKey));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(ordered)));
  return { version: toBase64Url(new Uint8Array(digest)), policies: ordered };
}

/**
 * Reads the policy set bundled into the Worker.
 *
 * @ensures The bundled set, refused when its version is not the hash of its policies.
 */
export async function parseBundledPolicySet(json: unknown): Promise<PolicySet> {
  const bundled = bundledSet.parse(json);
  const recomputed = await policySetOf(bundled.policies);
  if (recomputed.version !== bundled.version)
    throw new Error("The bundled policy set's version is not its content's hash.");
  return recomputed;
}

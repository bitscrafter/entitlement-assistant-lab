import { parseBundledPolicySet } from "../../../subsystem/policy/src/infra/policy-set-source.ts";
import type { PolicySet } from "../../../subsystem/policy/src/model/policy.ts";
import bundled from "../resource/policies/policy-set.json" with { type: "json" };

/** The policy set bundled into the Worker by `npm run policies:build` (policy §6). */
export function loadBundledPolicySet(): Promise<PolicySet> {
  return parseBundledPolicySet(bundled);
}

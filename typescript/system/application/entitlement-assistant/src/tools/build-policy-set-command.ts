import { readdir, readFile, writeFile } from "node:fs/promises";
import { CelPolicyExpressionEvaluator } from "../../../../subsystem/policy/src/infra/cel-policy-expression-evaluator.ts";
import { parsePolicyFile, policySetOf } from "../../../../subsystem/policy/src/infra/policy-set-source.ts";
import { policySetViolations } from "../../../../subsystem/policy/src/model/policy.ts";
import { readActionKeys } from "../database/seed.ts";

/** Checks the policy files and bundles them, versioned, into policy-set.json, which the Worker imports (policy §6). */
const directory = new URL("../../resource/policies/", import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith(".yaml")).sort();
const policies = await Promise.all(
  files.map(async (name) => parsePolicyFile(await readFile(new URL(name, directory), "utf8"))),
);
const misnamed = files.filter((name, index) => name !== `${policies[index]?.policyKey}.yaml`);
const evaluator = new CelPolicyExpressionEvaluator();
const violations = [
  ...misnamed.map((name) => `${name}: the file is not named after its policy key`),
  ...policySetViolations(policies, await readActionKeys(), (expression) => evaluator.check(expression)),
];
if (violations.length > 0) {
  console.error(`The policy set is refused:\n${violations.join("\n")}`);
  process.exit(1);
}
const set = await policySetOf(policies);
await writeFile(new URL("policy-set.json", directory), `${JSON.stringify(set, null, 2)}\n`);
console.log(`Bundled ${set.policies.length} policies, version ${set.version}.`);

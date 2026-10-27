import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresConnection } from "../../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../../adapter/tests/support/database.ts";
import { parseYaml } from "../../../../../external/yaml.ts";
import { CelPolicyExpressionEvaluator } from "../../../../../subsystem/policy/src/infra/cel-policy-expression-evaluator.ts";
import { parsePolicyFile, policySetOf } from "../../../../../subsystem/policy/src/infra/policy-set-source.ts";
import { combinePolicies, type PolicyAttributes } from "../../../../../subsystem/policy/src/model/policy.ts";
import { loadBundledPolicySet } from "../../../src/policy-set.ts";

const CASES = new URL("./cases/", import.meta.url);
const POLICIES = new URL("../../../resource/policies/", import.meta.url);

interface PolicyCase {
  readonly name: string;
  readonly given: Partial<Record<keyof PolicyAttributes, Record<string, unknown>>>;
  readonly then: boolean;
}

const caseFiles = (await readdir(CASES)).filter((name) => name.endsWith(".cases.yaml")).sort();
const cases = (
  await Promise.all(
    caseFiles.map(async (name) => {
      const file = parseYaml(await readFile(new URL(name, CASES), "utf8")) as {
        policy_key: string;
        cases: PolicyCase[];
      };
      return file.cases.map((policyCase) => ({ policyKey: file.policy_key, ...policyCase }));
    }),
  )
).flat();
const bundled = await loadBundledPolicySet();
const evaluator = new CelPolicyExpressionEvaluator();

describe("the bundled policy set", () => {
  test("ensures it is the set of the policy files, versioned by their content", async () => {
    const files = (await readdir(POLICIES)).filter((name) => name.endsWith(".yaml"));
    const policies = await Promise.all(
      files.map(async (name) => parsePolicyFile(await readFile(new URL(name, POLICIES), "utf8"))),
    );
    expect(await policySetOf(policies)).toEqual(bundled);
  });

  test("invariant every policy has a case file, and every case file names a policy", () => {
    expect(caseFiles.map((name) => name.replace(".cases.yaml", ""))).toEqual(
      bundled.policies.map((policy) => policy.policyKey),
    );
  });

  test.each(cases)("ensures $policyKey: $name is $then", ({ policyKey, given, then }) => {
    const policy = bundled.policies.find((candidate) => candidate.policyKey === policyKey);
    expect(policy).toBeDefined();
    const attributes = {
      principal: {},
      resource: {},
      context: {},
      environment: {},
      ...given,
    } as PolicyAttributes;
    const action = policy?.governedActions[0] ?? "";
    const finding = combinePolicies(policy === undefined ? [] : [policy], action, (expression) =>
      evaluator.evaluate(expression, attributes),
    );
    expect(finding.outcome === "Allow").toBe(then);
  });
});

describe("the seeded policy set", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;
  beforeAll(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
  });
  afterAll(async () => {
    await connection.close();
    await database.drop();
  });

  test("ensures the stored set is the bundled one, active, and its version the hash of its stored rows", async () => {
    const rows = await connection.query<{
      policy_key: string;
      description: string;
      applies_when: string;
      requires: string;
      unmet_outcome: "Deny" | "Conditional";
      actions: string[];
      prerequisites: { prerequisite_kind: "Approval"; fulfilled_by_permission: string }[];
    }>(
      `SELECT p.policy_key, p.description, p.applies_when, p.requires, p.unmet_outcome,
              (SELECT array_agg(action_key ORDER BY action_key) FROM policy_governed_action g
                WHERE g.policy_set_version = p.policy_set_version AND g.policy_key = p.policy_key) AS actions,
              (SELECT coalesce(json_agg(json_build_object('prerequisite_kind', r.prerequisite_kind,
                                                          'fulfilled_by_permission', r.fulfilled_by_permission)), '[]')
                 FROM policy_prerequisite r
                WHERE r.policy_set_version = p.policy_set_version AND r.policy_key = p.policy_key) AS prerequisites
         FROM policy p WHERE p.policy_set_version = $1`,
      [bundled.version],
    );
    const stored = await policySetOf(
      rows.map((row) => ({
        policyKey: row.policy_key,
        description: row.description,
        governedActions:
          bundled.policies
            .find((policy) => policy.policyKey === row.policy_key)
            ?.governedActions.filter((action) => row.actions.includes(action)) ?? [],
        appliesWhen: row.applies_when,
        requires: row.requires,
        unmetOutcome: row.unmet_outcome,
        prerequisites: row.prerequisites.map((item) => ({
          prerequisiteKind: item.prerequisite_kind,
          fulfilledByPermission: item.fulfilled_by_permission,
        })),
      })),
    );
    expect(stored.version).toBe(bundled.version);
    const active = await connection.query(
      "SELECT 1 FROM policy_set_activation WHERE policy_set_version = $1 AND ended_at IS NULL",
      [bundled.version],
    );
    expect(active).toHaveLength(1);
  });
});

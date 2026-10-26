import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FixedClock } from "../../../../adapter/clock/fixed-clock.ts";
import { PostgresConnection } from "../../../../adapter/postgres/postgres-connection.ts";
import { createTestDatabase, type TestDatabase } from "../../../../adapter/tests/support/database.ts";
import type { DecisionRequest } from "../../../../port/authorization-decider.ts";
import { PostgresInternalAccountRepository } from "../../../../subsystem/account/src/infra/postgres-internal-account-repository.ts";
import { LoadPrincipal } from "../../../../subsystem/account/src/usecase/load-principal.ts";
import { PostgresEmployeeRepository } from "../../../../subsystem/internal-identity/src/infra/postgres-employee-repository.ts";
import { GetEmployeeProfile } from "../../../../subsystem/internal-identity/src/usecase/get-employee-profile.ts";
import {
  PolicySetActivationCheck,
  PolicySetInactiveError,
} from "../../../../subsystem/policy/src/usecase/evaluate-policies.ts";
import { composeCaseWork } from "../../src/compose-case-work.ts";
import { seededUuid } from "../../src/database/seed.ts";
import { loadBundledPolicySet } from "../../src/policy-set.ts";
import { placeHold } from "../support/harness.ts";

const AT = new Date("2026-10-22T15:00:00Z");
const employee = (alias: string) => ({ kind: "Employee", accountId: seededUuid(alias) }) as const;
const individual = (alias: string) => ({ kind: "Individual", accountId: seededUuid(alias) }) as const;

describe("the decision chain over the seeded data (AU-1)", () => {
  let database: TestDatabase;
  let connection: PostgresConnection;
  let decide: (
    request: DecisionRequest,
  ) => ReturnType<ReturnType<typeof composeCaseWork>["decider"]["decide"]>;
  let caseWork: ReturnType<typeof composeCaseWork>;

  beforeEach(async () => {
    database = await createTestDatabase();
    connection = await PostgresConnection.open(database.connectionString);
    caseWork = composeCaseWork(connection, {
      clock: new FixedClock(AT),
      loadPrincipal: new LoadPrincipal({
        accounts: new PostgresInternalAccountRepository(connection),
        getEmployeeProfile: new GetEmployeeProfile({ employees: new PostgresEmployeeRepository(connection) }),
      }),
      policySet: await loadBundledPolicySet(),
      policySetActivation: new PolicySetActivationCheck(),
    });
    decide = (request) => caseWork.decider.decide(request);
  });

  afterEach(async () => {
    await connection.close();
    await database.drop();
  });

  const read = (alias: string, subject: string): DecisionRequest => ({
    principal: employee(alias),
    actionKey: "account.read",
    subjectAccountId: seededUuid(subject),
  });
  const feature = (person: string, subject: string, actionKey: string): DecisionRequest => ({
    principal: individual(person),
    actionKey,
    subjectAccountId: seededUuid(subject),
  });

  test("invariant deny-by-default: nothing is allowed unless a role grants the permission", async () => {
    expect(await decide(read("iac_drew", "acc_initech"))).toMatchObject({
      outcome: "Deny",
      reasonCodes: ["access.permission-not-held"],
    });
    expect(await decide(feature("acc_jane", "acc_initech", "feature.sso.configure"))).toMatchObject({
      outcome: "Deny",
      reasonCodes: ["access.permission-not-held", "entitlement.feature-not-included"],
    });
  });

  test("invariant principal-loaded-fresh: a hold placed after sign-in denies the next decision", async () => {
    expect((await decide(read("iac_blair", "acc_initech"))).outcome).toBe("Allow");
    await placeHold(connection, "iac_blair", "OperationalSuspension", new Date("2026-10-22T14:59:00Z"));
    expect(await decide(read("iac_blair", "acc_initech"))).toMatchObject({
      outcome: "Deny",
      reasonCodes: ["account.operational-suspension"],
      findings: [{ source: "account" }],
    });
  });

  test("ensures every handler runs: access and entitlement both report", async () => {
    const decision = await decide(feature("acc_lee", "acc_globex", "feature.api-access.create-token"));
    expect(decision.findings.map((finding) => [finding.source, finding.outcome])).toEqual([
      ["access", "Allow"],
      ["entitlement", "Deny"],
    ]);
    expect(decision.reasonCodes).toEqual(["entitlement.no-covering-term"]);
  });

  test("ensures a suspended person, or a suspended subject of a feature action, ends the chain after the account step", async () => {
    expect((await decide(feature("acc_dan", "acc_acme", "feature.sso.configure"))).findings).toEqual([
      { source: "account", outcome: "Deny", reasonCodes: ["account.no-active-membership"] },
    ]);
    expect((await decide(feature("acc_pat", "acc_umbrella", "feature.sso.configure"))).findings).toEqual([
      { source: "account", outcome: "Deny", reasonCodes: ["account.operational-suspension"] },
    ]);
  });

  test("ensures employees still read a suspended account (AC-6)", async () => {
    expect((await decide(read("iac_blair", "acc_umbrella"))).outcome).toBe("Allow");
  });

  test("ensures an access finding names the roles granting the permission", async () => {
    const sso = await decide(feature("acc_jane", "acc_acme", "feature.sso.configure"));
    expect(sso.findings[0]).toEqual({
      source: "access",
      outcome: "Allow",
      reasonCodes: [],
      grantedByRoles: ["admin"],
    });
    const exportLog = await decide(feature("acc_jane", "acc_acme", "feature.audit-log-export.export"));
    expect(exportLog.findings[0]).toMatchObject({ grantedByRoles: ["admin", "billing"] });
  });

  test("ensures an account role assignment without a justifying membership grants nothing (access §6)", async () => {
    await connection.query(
      `INSERT INTO account_role_assignment (assignment_id, member_account_id, member_of_account_id, role_key, assigned_at, assigned_by)
       VALUES (gen_random_uuid(), $1, $2, 'admin', '2026-10-01T00:00:00Z', $1)`,
      [seededUuid("acc_mia"), seededUuid("acc_acme")],
    );
    expect(await decide(feature("acc_mia", "acc_acme", "feature.sso.configure"))).toMatchObject({
      outcome: "Deny",
      reasonCodes: ["access.permission-not-held"],
    });
  });

  test.each([
    ["iac_alex", "acc_umbrella", "Deny"],
    ["iac_alex", "acc_tyrell", "Deny"],
    ["iac_blair", "acc_umbrella", "Allow"],
    ["iac_sam", "acc_tyrell", "Allow"],
    ["iac_alex", "acc_initech", "Allow"],
  ])("ensures the Enterprise read policy: %s reading %s is %s", async (principal, subject, outcome) => {
    const decision = await decide(read(principal, subject));
    expect(decision.outcome).toBe(outcome);
    expect(decision.reasonCodes).toEqual(
      outcome === "Deny" ? ["policy.enterprise-accounts-need-level-2"] : [],
    );
    expect(decision.policySetVersion).toBe((await loadBundledPolicySet()).version);
  });

  test("ensures the permission gate is the access step alone", async () => {
    expect(
      await caseWork.decider.decidePermission({ principal: employee("iac_drew"), actionKey: "account.read" }),
    ).toMatchObject({
      outcome: "Deny",
      reasonCodes: ["access.permission-not-held"],
      findings: [{ source: "access" }],
    });
    expect(
      (
        await caseWork.decider.decidePermission({
          principal: employee("iac_alex"),
          actionKey: "account.read",
        })
      ).outcome,
    ).toBe("Allow");
  });

  test("invariant no decision is made with a policy set that is not active (fail closed)", async () => {
    await connection.query("UPDATE policy_set_activation SET ended_at = $1, ended_by = $2", [
      AT,
      seededUuid("iac_sam"),
    ]);
    await expect(decide(read("iac_blair", "acc_initech"))).rejects.toBeInstanceOf(PolicySetInactiveError);
  });
});

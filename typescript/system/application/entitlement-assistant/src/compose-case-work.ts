import type { PostgresConnection } from "../../../adapter/postgres/postgres-connection.ts";
import type { Clock } from "../../../port/clock.ts";
import { PostgresRoleRepository } from "../../../subsystem/access/src/infra/postgres-role-repository.ts";
import { ListAccountRoles } from "../../../subsystem/access/src/usecase/list-account-roles.ts";
import { LoadPrincipalPermissions } from "../../../subsystem/access/src/usecase/load-principal-permissions.ts";
import { PostgresCustomerAccountRepository } from "../../../subsystem/account/src/infra/postgres-customer-account-repository.ts";
import { AccountVersions } from "../../../subsystem/account/src/usecase/account-versions.ts";
import { GetCustomerAccount } from "../../../subsystem/account/src/usecase/get-customer-account.ts";
import type { LoadPrincipal } from "../../../subsystem/account/src/usecase/load-principal.ts";
import { Decide } from "../../../subsystem/authorization/src/usecase/decide.ts";
import { PostgresCustomerRepository } from "../../../subsystem/customer-identity/src/infra/postgres-customer-repository.ts";
import { FindIndividualByEmail } from "../../../subsystem/customer-identity/src/usecase/find-individual-by-email.ts";
import { GetIndividuals } from "../../../subsystem/customer-identity/src/usecase/get-individuals.ts";
import { HasActiveMembership } from "../../../subsystem/customer-identity/src/usecase/has-active-membership.ts";
import { PostgresSubscriptionRepository } from "../../../subsystem/entitlement/src/infra/postgres-subscription-repository.ts";
import { ComputeEffectiveEntitlements } from "../../../subsystem/entitlement/src/usecase/compute-effective-entitlements.ts";
import { JudgeGrantChange } from "../../../subsystem/entitlement/src/usecase/judge-grant-change.ts";
import { CelPolicyExpressionEvaluator } from "../../../subsystem/policy/src/infra/cel-policy-expression-evaluator.ts";
import { PostgresPolicySetRepository } from "../../../subsystem/policy/src/infra/postgres-policy-set-repository.ts";
import type { PolicySet } from "../../../subsystem/policy/src/model/policy.ts";
import {
  EvaluatePolicies,
  type PolicySetActivationCheck,
} from "../../../subsystem/policy/src/usecase/evaluate-policies.ts";
import { PostgresCatalogRepository } from "../../../subsystem/product/src/infra/postgres-catalog-repository.ts";
import { FindLowestPlanIncluding } from "../../../subsystem/product/src/usecase/find-lowest-plan-including.ts";
import { GetCatalog } from "../../../subsystem/product/src/usecase/get-catalog.ts";

/** The CEL environment is built once per isolate; it holds no state between evaluations. */
const evaluator = new CelPolicyExpressionEvaluator();

/**
 * The building blocks of case work on one connection: the lower subsystems' use cases and the decision point.
 * Part of the composition root: wiring only.
 */
export function composeCaseWork(
  connection: PostgresConnection,
  dependencies: {
    readonly clock: Clock;
    readonly loadPrincipal: LoadPrincipal;
    readonly policySet: PolicySet;
    readonly policySetActivation: PolicySetActivationCheck;
  },
) {
  const { clock } = dependencies;
  const customers = new PostgresCustomerRepository(connection);
  const customerAccounts = new PostgresCustomerAccountRepository(connection);
  const getCustomerAccount = new GetCustomerAccount({ accounts: customerAccounts });
  const hasActiveMembership = new HasActiveMembership({ customers });
  const roles = new PostgresRoleRepository(connection);
  const getCatalog = new GetCatalog({ catalogs: new PostgresCatalogRepository(connection) });
  const subscriptions = new PostgresSubscriptionRepository(connection);
  const computeEffectiveEntitlements = new ComputeEffectiveEntitlements({
    getCustomerAccount,
    getCatalog,
    subscriptions,
  });
  const evaluatePolicies = new EvaluatePolicies({
    policySet: dependencies.policySet,
    evaluator,
    policySets: new PostgresPolicySetRepository(connection),
    activation: dependencies.policySetActivation,
    clock,
  });
  const decider = new Decide({
    loadPrincipal: dependencies.loadPrincipal,
    getCustomerAccount,
    loadPrincipalPermissions: new LoadPrincipalPermissions({
      roles,
      getCustomerAccount,
      hasActiveMembership,
    }),
    computeEffectiveEntitlements,
    judgeGrantChange: new JudgeGrantChange({ subscriptions }),
    evaluatePolicies,
    getCatalog,
    clock,
  });
  return {
    decider,
    getCatalog,
    getCustomerAccount,
    accountVersions: new AccountVersions({ accounts: customerAccounts }),
    computeEffectiveEntitlements,
    findLowestPlanIncluding: new FindLowestPlanIncluding({ getCatalog }),
    findIndividualByEmail: new FindIndividualByEmail({ customers }),
    getIndividuals: new GetIndividuals({ customers }),
    listAccountRoles: new ListAccountRoles({ roles, clock }),
  };
}

export type CaseWork = ReturnType<typeof composeCaseWork>;

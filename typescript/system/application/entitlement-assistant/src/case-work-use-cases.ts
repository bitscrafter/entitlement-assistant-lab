import type { CheckEntitlement } from "../../../subsystem/support/src/usecase/check-entitlement.ts";
import type { ExplainAccess } from "../../../subsystem/support/src/usecase/explain-access.ts";
import type { FindCustomerAccount } from "../../../subsystem/support/src/usecase/find-customer-account.ts";
import type { ListEntitlements } from "../../../subsystem/support/src/usecase/list-entitlements.ts";
import type { OpenCase } from "../../../subsystem/support/src/usecase/open-case.ts";

/** The use cases a case agent's tools and the verification tests call (api.md §10). */
export interface CaseWorkUseCases {
  readonly openCase: OpenCase;
  readonly findCustomerAccount: FindCustomerAccount;
  readonly checkEntitlement: CheckEntitlement;
  readonly listEntitlements: ListEntitlements;
  readonly explainAccess: ExplainAccess;
}

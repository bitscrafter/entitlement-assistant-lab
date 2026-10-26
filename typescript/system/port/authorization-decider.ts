import type { EntitlementSource, ReasonFacts } from "../kernel/entitlement.ts";
import type { Uuid } from "../kernel/identifier.ts";

export type DecisionOutcome = "Allow" | "Deny" | "Conditional";

/** The account a decision is made for (account §1): an employee's, or an individual's when an access is explained. */
export type DecisionPrincipal =
  | { readonly kind: "Employee"; readonly accountId: Uuid }
  | { readonly kind: "Individual"; readonly accountId: Uuid };

/** One handler's finding (AU-2), by the step that produced it. */
export type Finding =
  | { readonly source: "account"; readonly outcome: DecisionOutcome; readonly reasonCodes: readonly string[] }
  | {
      readonly source: "access";
      readonly outcome: DecisionOutcome;
      readonly reasonCodes: readonly string[];
      /** The roles that grant the permission; empty when it is held through a direct assignment only. */
      readonly grantedByRoles: readonly string[];
    }
  | {
      readonly source: "entitlement";
      readonly outcome: DecisionOutcome;
      readonly reasonCodes: readonly string[];
      readonly sources: readonly EntitlementSource[];
      readonly coveringTermSource: string | null;
      readonly facts: ReasonFacts;
    }
  | {
      readonly source: "policy";
      readonly outcome: DecisionOutcome;
      readonly reasonCodes: readonly string[];
      readonly prerequisites: readonly {
        readonly prerequisiteKind: "Approval";
        readonly fulfilledByPermission: string;
      }[];
    };

export interface Decision {
  /** The most restrictive outcome of the findings (AU-2). */
  readonly outcome: DecisionOutcome;
  readonly findings: readonly Finding[];
  /** Every reason code of a finding that is not `Allow`, unique and sorted. */
  readonly reasonCodes: readonly string[];
  readonly policySetVersion: string;
}

export interface DecisionRequest {
  readonly principal: DecisionPrincipal;
  readonly actionKey: string;
  /** The account context: the subject account the action is about; null for an action without one. */
  readonly subjectAccountId: Uuid | null;
}

/** The Policy Decision Point, reached by every subsystem through this port only (CM-17, AU-5). */
export interface AuthorizationDecider {
  /**
   * The decision chain (AU-1): account, access, contact access, entitlement (feature actions), policy.
   *
   * @ensures Every handler runs, except that a suspension stopping the action ends the chain after the account step.
   * @ensures The principal and the subject are loaded fresh (rule principal-loaded-fresh).
   */
  decide(request: DecisionRequest): Promise<Decision>;

  /**
   * The permission gate (explain-access D12): the access step alone, before any customer data is read.
   *
   * @ensures `Allow` exactly when the principal holds the permission; otherwise `Deny` with
   *          `access.permission-not-held`. No subject is read and no policy is evaluated.
   */
  decidePermission(request: Omit<DecisionRequest, "subjectAccountId">): Promise<Decision>;
}

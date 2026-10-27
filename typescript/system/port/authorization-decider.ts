import type { EntitlementSource, ReasonFacts } from "../kernel/entitlement.ts";
import type { Uuid } from "../kernel/identifier.ts";

export type DecisionOutcome = "Allow" | "Deny" | "Conditional";

/** The account a decision is made for (account §1): an employee's, or an individual's when an access is explained. */
export type DecisionPrincipal =
  | { readonly kind: "Employee"; readonly accountId: Uuid }
  | { readonly kind: "Individual"; readonly accountId: Uuid }
  /** A system identity's account (account §1): the approval process and the grant expiry sweep (grants-and-approvals). */
  | { readonly kind: "System"; readonly accountId: Uuid };

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
      readonly source: "contact-access";
      readonly outcome: DecisionOutcome;
      readonly reasonCodes: readonly string[];
      /** The contact's roles in the subject that grant the customer permission; empty when refused. */
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

/**
 * What a change asks for, as the enforcing use case knows it from trusted data (AU-5): never from the model.
 * Absent fields are attributes with no value.
 */
export interface DecisionContext {
  /** The feature a grant change is about. */
  readonly featureKey?: string;
  /** The quota a grant adds; absent for an unmetered feature. */
  readonly quota?: number;
  /**
   * The window a grant change would grant: its days are counted with the days already granted for the feature on
   * the subject within the last 90 days (grants-and-approvals D5).
   */
  readonly grantWindow?: { readonly startsAt: Date; readonly endsAt: Date };
  /** The grant an extension ends: it does not count as already including the feature (D13). */
  readonly extendsGrantId?: Uuid;
  /** Whether the case's contact is authenticated, as of the moment that counts (D3, D8). */
  readonly contactAuthenticated?: boolean;
  readonly requesterAccountId?: Uuid;
  readonly confirmerAccountId?: Uuid;
  /** A supervisor approved the change (D8). */
  readonly approvalGranted?: boolean;
}

export interface DecisionRequest {
  readonly principal: DecisionPrincipal;
  readonly actionKey: string;
  /** The account context: the subject account the action is about; null for an action without one. */
  readonly subjectAccountId: Uuid | null;
  /** The case's contact on whose behalf a change is asked (SU-8); absent or null for the principal's own initiative. */
  readonly contactAccountId?: Uuid | null;
  readonly context?: DecisionContext;
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

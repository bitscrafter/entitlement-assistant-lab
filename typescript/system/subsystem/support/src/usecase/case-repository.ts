import type { Uuid } from "../../../../kernel/identifier.ts";
import type { AuthenticationKind, AuthenticationMethod } from "../model/contact-authentication.ts";

export interface ContactAuthentication {
  readonly authenticatedAt: Date;
  readonly kind: AuthenticationKind;
  readonly method: AuthenticationMethod;
  readonly authenticatedBy: Uuid;
}

/** A case as Support stores it (support §2). */
export interface SupportCase {
  readonly caseId: Uuid;
  readonly subjectAccountId: Uuid | null;
  readonly contactAccountId: Uuid | null;
  readonly contactAuthentication: ContactAuthentication | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly closeReason: CloseReason | null;
  readonly summary: string | null;
  /** The current assignee; null once the case is closed. */
  readonly assigneeAccountId: Uuid | null;
}

export type CloseReason = "Resolved" | "Abandoned";

export interface ClosedCase {
  readonly caseId: Uuid;
  readonly closedAt: Date;
  readonly closedBy: Uuid;
  readonly closeReason: CloseReason;
  readonly summary: string;
}

export interface CaseRepository {
  /**
   * Opens a case assigned to the opener.
   *
   * @ensures One open case without subject or contact, and its one current assignment to `openedBy`.
   */
  open(caseId: Uuid, assignmentId: Uuid, openedBy: Uuid, at: Date): Promise<void>;

  /** @ensures The current assignee of the case, null for a case that does not exist or has none. */
  currentAssignee(
    caseId: Uuid,
  ): Promise<{ readonly exists: boolean; readonly assigneeAccountId: Uuid | null }>;

  /** @ensures The case with its current assignee, or null. */
  find(caseId: Uuid): Promise<SupportCase | null>;

  /**
   * The case, locked until the caller's transaction ends: a concurrent action on the case waits, then reads what
   * this one committed (review R1, R2).
   *
   * @ensures As `find`, with the case's row locked.
   */
  findForUpdate(caseId: Uuid): Promise<SupportCase | null>;

  /**
   * @ensures Sets the subject only when the case has none, atomically (a concurrent setter waits, then finds it set).
   * @returns Whether the subject was set.
   */
  setSubjectIfUnset(caseId: Uuid, subjectAccountId: Uuid): Promise<boolean>;

  /** @ensures The contact is set and any authentication cleared (SU-10). */
  setContact(caseId: Uuid, contactAccountId: Uuid): Promise<void>;

  /** @ensures The contact's authentication is the one given. */
  recordAuthentication(caseId: Uuid, authentication: ContactAuthentication): Promise<void>;

  /** @ensures The contact has no authentication. */
  clearAuthentication(caseId: Uuid): Promise<void>;

  /**
   * Closes an open case (case-lifecycle D7).
   *
   * @ensures Closing fields and summary set, and the current assignment ended (`CaseClosed`), together.
   * @returns Whether the case was open.
   */
  close(
    caseId: Uuid,
    closing: { readonly at: Date; readonly by: Uuid; readonly reason: CloseReason; readonly summary: string },
  ): Promise<boolean>;

  /** @ensures The account's name as stored now, kept for the case's events under `nameId` (D21; review R5-1). */
  recordAccountName(
    nameId: Uuid,
    name: {
      readonly caseId: Uuid;
      readonly accountId: Uuid;
      readonly displayName: string;
      readonly at: Date;
    },
  ): Promise<void>;

  /** @ensures The kept names among `nameIds`, by id. */
  accountNames(nameIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, string>>;

  /** @ensures At most `limit` closed cases of the subject, newest first (D17). */
  closedCasesOf(subjectAccountId: Uuid, limit: number): Promise<readonly ClosedCase[]>;
}

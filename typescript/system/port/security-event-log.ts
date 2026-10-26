/** Why a request was rejected before any principal could be attributed (attribution §1, security event logs). */
export type SecurityEventCause =
  | "NoSession"
  | "MalformedToken"
  | "InvalidSignature"
  | "UnsupportedAlgorithm"
  | "WrongIssuer"
  | "WrongAudience"
  | "Expired"
  | "PrincipalInactive"
  | "ForeignOrigin"
  | "CaseNotFound"
  | "CaseNotAssigned";

export interface SecurityEvent {
  readonly cause: SecurityEventCause;
  readonly method: string;
  readonly path: string;
  readonly traceId: string;
}

/** Records rejected requests for attack analysis. Holds no personal data. */
export interface SecurityEventLog {
  /** @ensures The event is recorded; recording never fails the request. */
  record(event: SecurityEvent): void;
}

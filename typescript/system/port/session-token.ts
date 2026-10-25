import type { Uuid } from "../kernel/identifier.ts";
import type { Result } from "../kernel/result.ts";

/** What a session token says: who, never what they may do (CM-16). */
export interface SessionClaims {
  readonly accountId: Uuid;
  readonly sessionId: Uuid;
  readonly tokenId: Uuid;
  readonly authenticatedAt: Date;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export type TokenRejection =
  | "MalformedToken"
  | "InvalidSignature"
  | "UnsupportedAlgorithm"
  | "WrongIssuer"
  | "WrongAudience"
  | "Expired";

export interface SessionTokenIssuer {
  /** @ensures A signed token carrying exactly `claims`, verifiable by the matching verifier. */
  issue(claims: SessionClaims): Promise<string>;
}

export interface SessionTokenVerifier {
  /**
   * @ensures Succeeds only for a token signed with the server's key, with the expected algorithm, issuer, and
   *          audience, not expired at `now`, whose identifiers have their expected kinds.
   */
  verify(token: string, now: Date): Promise<Result<SessionClaims, TokenRejection>>;
}

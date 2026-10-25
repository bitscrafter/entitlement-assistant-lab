import { joseErrors, jwtVerify, SignJWT } from "../../external/jose.ts";
import {
  decodeIdentifier,
  encodeIdentifier,
  type IdentifierPrefix,
  type Uuid,
} from "../../kernel/identifier.ts";
import { failure, type Result, success } from "../../kernel/result.ts";
import type {
  SessionClaims,
  SessionTokenIssuer,
  SessionTokenVerifier,
  TokenRejection,
} from "../../port/session-token.ts";

const ISSUER = "entitlement-assistant";
const AUDIENCE = "entitlement-assistant";
const ALGORITHM = "ES256";

const seconds = (instant: Date) => Math.floor(instant.getTime() / 1000);

/** ES256 session tokens through `jose`: no hand-written cryptography (AI_AS_DEVELOPER.md §1). */
export class JoseSessionToken implements SessionTokenIssuer, SessionTokenVerifier {
  readonly #keyId: string;
  readonly #privateKey: CryptoKey;
  readonly #publicKey: CryptoKey;

  constructor(signingKey: {
    readonly keyId: string;
    readonly privateKey: CryptoKey;
    readonly publicKey: CryptoKey;
  }) {
    this.#keyId = signingKey.keyId;
    this.#privateKey = signingKey.privateKey;
    this.#publicKey = signingKey.publicKey;
  }

  issue(claims: SessionClaims): Promise<string> {
    return new SignJWT({
      sid: encodeIdentifier("ses", claims.sessionId),
      auth_time: seconds(claims.authenticatedAt),
    })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.#keyId, typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(encodeIdentifier("iac", claims.accountId))
      .setIssuedAt(seconds(claims.issuedAt))
      .setExpirationTime(seconds(claims.expiresAt))
      .setJti(encodeIdentifier("jti", claims.tokenId))
      .sign(this.#privateKey);
  }

  async verify(token: string, now: Date): Promise<Result<SessionClaims, TokenRejection>> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, this.#publicKey, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: now,
        clockTolerance: 0,
        requiredClaims: ["sub", "sid", "auth_time", "iat", "exp", "jti"],
      }));
    } catch (error) {
      return failure(rejectionOf(error));
    }
    const accountId = identifier("iac", payload.sub);
    const sessionId = identifier("ses", payload.sid);
    const tokenId = identifier("jti", payload.jti);
    const { auth_time: authTime, iat, exp } = payload;
    if (
      accountId === null ||
      sessionId === null ||
      tokenId === null ||
      typeof authTime !== "number" ||
      typeof iat !== "number" ||
      typeof exp !== "number"
    ) {
      return failure("MalformedToken");
    }
    return success({
      accountId,
      sessionId,
      tokenId,
      authenticatedAt: new Date(authTime * 1000),
      issuedAt: new Date(iat * 1000),
      expiresAt: new Date(exp * 1000),
    });
  }
}

function identifier(prefix: IdentifierPrefix, value: unknown): Uuid | null {
  if (typeof value !== "string") return null;
  const decoded = decodeIdentifier(prefix, value);
  return decoded.ok ? decoded.value : null;
}

function rejectionOf(error: unknown): TokenRejection {
  if (error instanceof joseErrors.JWTExpired) return "Expired";
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) return "InvalidSignature";
  if (error instanceof joseErrors.JOSEAlgNotAllowed || error instanceof joseErrors.JOSENotSupported) {
    return "UnsupportedAlgorithm";
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "WrongIssuer";
    if (error.claim === "aud") return "WrongAudience";
  }
  return "MalformedToken";
}

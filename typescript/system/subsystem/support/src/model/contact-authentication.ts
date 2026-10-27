/**
 * How a contact was authenticated (SU-10, case-lifecycle D4, D5): a kind (the factor category) and a method. The
 * CSR records the outcome of a check made outside the system; support never asks for a password.
 */

export type AuthenticationKind = "Knowledge" | "Possession";
export type AuthenticationMethod = "SecurityQuestion" | "AccountDetails" | "SupportPasscode" | "OneTimeCode";

const KIND_OF_METHOD: Readonly<Record<AuthenticationMethod, AuthenticationKind>> = {
  SecurityQuestion: "Knowledge",
  AccountDetails: "Knowledge",
  SupportPasscode: "Knowledge",
  OneTimeCode: "Possession",
};

/** The methods this deployment accepts: a passcode or a one-time code would need the system to check them. */
const ACCEPTED_METHODS: ReadonlySet<AuthenticationMethod> = new Set(["SecurityQuestion", "AccountDetails"]);

/** How long an authentication counts (D5). */
export const AUTHENTICATION_VALIDITY_MILLISECONDS = 30 * 60 * 1000;

export type MethodCheck =
  | {
      readonly kind: "Accepted";
      readonly authenticationKind: AuthenticationKind;
      readonly method: AuthenticationMethod;
    }
  | { readonly kind: "NotAccepted" }
  | { readonly kind: "NotOfKind" };

const isMethod = (method: string): method is AuthenticationMethod => Object.hasOwn(KIND_OF_METHOD, method);

/**
 * @ensures `NotAccepted` for an unknown method (a password included) or one this deployment does not accept.
 * @ensures `NotOfKind` for a known method stated under another kind.
 * @ensures `Accepted` otherwise, with the typed kind and method.
 */
export function checkAuthenticationMethod(kind: string, method: string): MethodCheck {
  if (!isMethod(method)) return { kind: "NotAccepted" };
  if (KIND_OF_METHOD[method] !== kind) return { kind: "NotOfKind" };
  if (!ACCEPTED_METHODS.has(method)) return { kind: "NotAccepted" };
  return { kind: "Accepted", authenticationKind: KIND_OF_METHOD[method], method };
}

/** @ensures The instant an authentication made at `authenticatedAt` stops counting (D5). */
export function authenticationExpiresAt(authenticatedAt: Date): Date {
  return new Date(authenticatedAt.getTime() + AUTHENTICATION_VALIDITY_MILLISECONDS);
}

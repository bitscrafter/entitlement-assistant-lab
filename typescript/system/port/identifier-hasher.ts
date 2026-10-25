/** Turns an identifier someone typed into a keyed hash, so logs and audit records hold no personal data. */
export interface IdentifierHasher {
  /** @ensures The same text always gives the same 22-character base64url value; the text cannot be recovered. */
  hash(text: string): Promise<string>;
}

/** Hashes and verifies employee passwords, stored as PHC strings (internal-identity data model). */
export interface PasswordHasher {
  /**
   * @ensures Returns a PHC string with a fresh random salt; hashing one password twice gives two strings.
   */
  hash(password: string): Promise<string>;

  /**
   * Checks a password against a stored PHC string, or against nothing when the identity is unknown.
   *
   * @ensures Returns true only when `passwordHash` is a PHC string of `password`.
   * @ensures With `passwordHash` null it does the same derivation work and returns false, so the response
   *          time does not reveal whether an identity exists.
   * @ensures Comparison takes the same time wherever the hashes differ.
   */
  verify(password: string, passwordHash: string | null): Promise<boolean>;
}

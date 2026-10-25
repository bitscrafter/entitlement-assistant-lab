import { toBase64Url } from "../../kernel/identifier.ts";
import type { IdentifierHasher } from "../../port/identifier-hasher.ts";

/** HMAC-SHA-256 with a dedicated secret key, truncated to 16 bytes. */
export class HmacIdentifierHasher implements IdentifierHasher {
  readonly #key: CryptoKey;

  constructor(key: CryptoKey) {
    this.#key = key;
  }

  async hash(text: string): Promise<string> {
    const signature = await crypto.subtle.sign("HMAC", this.#key, new TextEncoder().encode(text));
    return toBase64Url(new Uint8Array(signature).subarray(0, 16));
  }
}

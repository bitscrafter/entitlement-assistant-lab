import { describe, expect, test } from "vitest";
import { PBKDF2_ITERATIONS, WebCryptoPasswordHasher } from "../src/infra/web-crypto-password-hasher.ts";

describe("WebCryptoPasswordHasher", () => {
  const hasher = new WebCryptoPasswordHasher();

  test("ensures a hash is a PHC string with a fresh salt", async () => {
    const first = await hasher.hash("alex-demo-password");
    const second = await hasher.hash("alex-demo-password");
    expect(first).toMatch(
      new RegExp(`^\\$pbkdf2-sha256\\$i=${PBKDF2_ITERATIONS}\\$[A-Za-z0-9+/]+\\$[A-Za-z0-9+/]+$`),
    );
    expect(first).not.toBe(second);
  });

  test("ensures verify returns true only for the password the hash was made from", async () => {
    const passwordHash = await hasher.hash("alex-demo-password");
    expect(await hasher.verify("alex-demo-password", passwordHash)).toBe(true);
    expect(await hasher.verify("wrong-password", passwordHash)).toBe(false);
    expect(await hasher.verify("", passwordHash)).toBe(false);
  });

  test("ensures verify against no hash returns false after the same derivation work", async () => {
    const passwordHash = await hasher.hash("alex-demo-password");
    const timed = async (work: () => Promise<boolean>) => {
      const start = performance.now();
      const result = await work();
      return { result, elapsed: performance.now() - start };
    };
    const known = await timed(() => hasher.verify("alex-demo-password", passwordHash));
    const unknown = await timed(() => hasher.verify("alex-demo-password", null));
    expect(unknown.result).toBe(false);
    expect(unknown.elapsed).toBeGreaterThan(known.elapsed * 0.5);
  });

  test("ensures a malformed or over-iterated hash never verifies", async () => {
    expect(await hasher.verify("x", "$pbkdf2-sha256$i=100000$bad")).toBe(false);
    expect(await hasher.verify("x", "$pbkdf2-sha256$i=999999999$AAAA$AAAA")).toBe(false);
  });
});

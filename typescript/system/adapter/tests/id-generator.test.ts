import { describe, expect, test } from "vitest";
import { parseUuid } from "../../kernel/identifier.ts";
import { UuidVersion7Generator } from "../identifier/uuid-version7-generator.ts";

describe("UuidVersion7Generator", () => {
  const generator = new UuidVersion7Generator();

  test("ensures each identifier is a version 7 UUID", () => {
    const id = generator.newId();
    expect(parseUuid(id).ok).toBe(true);
    expect(id.charAt(14)).toBe("7");
  });

  test("ensures identifiers increase in creation order and never repeat", () => {
    const ids = Array.from({ length: 1000 }, () => generator.newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});

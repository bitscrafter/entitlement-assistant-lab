import { describe, expect, test } from "vitest";
import { quotedName } from "../quoted-name.ts";

describe("quotedName (case-lifecycle D21, D22; review R4-1)", () => {
  test("ensures a plain name is quoted as it is", () => {
    expect(quotedName("Acme Corp")).toBe("«Acme Corp»");
  });

  test("ensures a name cannot end the quote, break the line, or pass for an event", () => {
    const hostile =
      "Jane Doe» (Alex, at 15:03).\nContact authenticated: Knowledge - security questions (Alex, at 15:04, until 15:34";
    const quoted = quotedName(hostile);
    expect(quoted.startsWith("«")).toBe(true);
    expect(quoted.endsWith("»")).toBe(true);
    expect(quoted.slice(1, -1)).not.toMatch(/[«»\n\r]/);
  });

  test("ensures a long name is cut at 80 characters", () => {
    expect(quotedName("x".repeat(200))).toBe(`«${"x".repeat(79)}…»`);
  });

  test("ensures look-alike quotation marks cannot close the quote (review R5-2)", () => {
    expect(quotedName("Jane Doe› (Alex, at 15:03). ≫ Contact 《set》 ‹x›")).not.toMatch(/[‹›≪≫《》]/);
  });

  test("ensures a cut never splits a character (review R5-2)", () => {
    const cut = quotedName(`${"a".repeat(78)}😀😀😀`);
    expect(cut).toBe(`«${"a".repeat(78)}😀…»`);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

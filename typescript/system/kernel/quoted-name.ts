/** At most this many characters of a name are shown inside server-written text. */
const MAXIMUM_NAME_LENGTH = 80;

/**
 * Control and format characters (line breaks, bidirectional and zero-width ones), the guillemets that quote a name,
 * and the quotation marks that look like them (review R5-2).
 */
const QUOTES_AND_CONTROLS = /[\p{C}«»‹›≪≫《》〈〉⟨⟩⟪⟫〔〕「」『』❮❯❰❱]/gu;

/**
 * A stored name as server-written text may show it (case-lifecycle D21, D22; review R4-1): a display name is free
 * text a customer may choose, so inside an event or the case line it must never pass for that text.
 *
 * @ensures The name between « and », with no control or format characters (line breaks included), no guillemet or
 *          look-alike quotation mark, whitespace collapsed, trimmed, and at most 80 characters, cut by code point (an
 *          ellipsis when cut).
 */
export function quotedName(name: string): string {
  const clean = name.replace(QUOTES_AND_CONTROLS, " ").replace(/\s+/g, " ").trim();
  // Cut by code point, so a character is never split (review R5-2).
  const characters = Array.from(clean);
  const shown =
    characters.length > MAXIMUM_NAME_LENGTH
      ? `${characters.slice(0, MAXIMUM_NAME_LENGTH - 1).join("")}…`
      : clean;
  return `«${shown}»`;
}

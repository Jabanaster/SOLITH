/**
 * Core Product Completion audit, Mission 1 - narrow, reusable normalization
 * for UNTRUSTED display text (catalog game titles/aliases, support-request
 * labels, favorite-visible names, and any future community-sourced string).
 *
 * Threat model: a catalog/community-sourced title containing Unicode bidi
 * FORMATTING characters (embeddings/overrides/isolates) can visually reorder
 * or conceal parts of itself or adjacent UI text - e.g. making a filename's
 * true extension read differently than it displays, or spoofing a different
 * game's name. Zero-width characters can likewise conceal characters or
 * defeat naive string comparisons in a UI list.
 *
 * This does NOT touch canonical stored identity (catalogGameId, database
 * rows) - it is applied ONLY at the display boundary, and only strips a
 * narrow, well-known set of bidi/invisible FORMATTING control characters.
 * It never ASCII-folds, transliterates, or otherwise mutates legitimate
 * international text - real Arabic/Hebrew/CJK/etc titles pass through
 * completely unchanged, including the harmless bidi MARKS (LRM U+200E and
 * RLM U+200F), which are deliberately NOT stripped: they only set the
 * directional property of their own (invisible) position and cannot
 * reorder other characters, and are common in genuine mixed-direction text.
 *
 * React's default text rendering ({text} in JSX) already prevents HTML/DOM
 * injection - this utility is a separate, narrower concern: visual spoofing
 * via legitimate-but-adversarial Unicode, not markup injection. It is
 * intentionally NOT a general sanitizer library - just the specific
 * character classes that enable bidi/zero-width spoofing.
 *
 * All stripped code points are listed by hex value only (no raw control
 * bytes appear in this source file, to keep the file itself free of the
 * exact characters it is written to strip).
 */

// Explicit bidi FORMATTING characters (embeddings, overrides, isolates, and
// their pop) - these are what actually let one part of a string change the
// rendered order of surrounding characters.
const BIDI_FORMATTING_CODEPOINTS: number[] = [
  0x202a, // LRE - Left-to-Right Embedding
  0x202b, // RLE - Right-to-Left Embedding
  0x202c, // PDF - Pop Directional Formatting
  0x202d, // LRO - Left-to-Right Override
  0x202e, // RLO - Right-to-Left Override
  0x2066, // LRI - Left-to-Right Isolate
  0x2067, // RLI - Right-to-Left Isolate
  0x2068, // FSI - First Strong Isolate
  0x2069, // PDI - Pop Directional Isolate
];

// Zero-width / invisible characters commonly used to conceal or split text.
const ZERO_WIDTH_CODEPOINTS: number[] = [
  0x200b, // ZERO WIDTH SPACE
  0x200c, // ZERO WIDTH NON-JOINER
  0x200d, // ZERO WIDTH JOINER
  0x2060, // WORD JOINER
  0xfeff, // ZERO WIDTH NO-BREAK SPACE / BOM
];

// C0 controls (U+0000-U+001F) minus tab (0x09), newline (0x0A), CR (0x0D);
// DEL (U+007F); and C1 controls (U+0080-U+009F). Non-whitespace control
// characters have no legitimate place in a single-line display title.
const CONTROL_CODEPOINT_RANGES: Array<[number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
];

function codepointsToCharClass(codepoints: number[]): string {
  return codepoints.map((cp) => `\\u{${cp.toString(16)}}`).join('');
}

function rangesToCharClass(ranges: Array<[number, number]>): string {
  return ranges.map(([start, end]) => `\\u{${start.toString(16)}}-\\u{${end.toString(16)}}`).join('');
}

const STRIP_PATTERN = new RegExp(
  `[${codepointsToCharClass(BIDI_FORMATTING_CODEPOINTS)}` +
    `${codepointsToCharClass(ZERO_WIDTH_CODEPOINTS)}` +
    `${rangesToCharClass(CONTROL_CODEPOINT_RANGES)}]`,
  'gu',
);

/**
 * Normalizes untrusted display text for safe rendering. Strips bidi
 * formatting characters, zero-width characters, and non-whitespace control
 * characters; leaves every other code point - including all legitimate
 * international scripts and harmless bidi marks - untouched. Never call
 * this on canonical identity strings (ids, keys) - display only.
 */
export function toSafeDisplayText(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(STRIP_PATTERN, '');
}

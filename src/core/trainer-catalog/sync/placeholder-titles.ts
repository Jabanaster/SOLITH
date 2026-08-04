/**
 * Community forums use bracketed placeholder titles for threads about
 * unannounced/embargoed games (e.g. "[REDACTED]"). These aren't real,
 * distinguishable game names — surfacing them as catalog entries is
 * confusing, not useful. Shared by ingestion (parse-html.ts, to stop new
 * placeholder rows being written) and catalog reads (store.ts, to hide
 * already-persisted placeholder rows without deleting them).
 */
export const PLACEHOLDER_TITLE_WORDS = [
  'redacted',
  'hidden',
  'unknown',
  'tba',
  'tbd',
  'unannounced',
  'classified',
] as const;

const PLACEHOLDER_TITLE_RE = new RegExp(
  `^\\[?(${PLACEHOLDER_TITLE_WORDS.join('|')})\\]?$`,
  'i',
);

export function isPlaceholderTitle(gameName: string): boolean {
  return PLACEHOLDER_TITLE_RE.test(gameName.trim());
}

/** Every literal (bracketed + unbracketed) form, for building an exact-match SQL exclusion list. */
export function placeholderTitleLiterals(): string[] {
  return PLACEHOLDER_TITLE_WORDS.flatMap((word) => [word, `[${word}]`]);
}

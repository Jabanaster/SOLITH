/**
 * Deterministic, title-derived fallback treatment for catalog cards with no
 * cover art. Pure/CSS-free so it can be unit-tested directly — see the
 * component-state convention established by trainer-library-verification-state.ts.
 *
 * Intentionally does NOT fetch, guess, or infer real artwork (no Steam App ID
 * lookups, no remote requests). It only varies the *presentation* of the
 * "no artwork yet" state per-title, so a catalog full of unresolved games
 * doesn't look like the same placeholder card repeated thousands of times.
 */
export interface FallbackArtworkTreatment {
  initial: string;
  hueA: number;
  hueB: number;
}

export function fallbackArtworkTreatment(displayName: string): FallbackArtworkTreatment {
  const trimmed = displayName.trim();
  // Many catalog titles lead with bracket/paren wrappers or punctuation
  // (e.g. "[NINJA GAIDEN]", "(the) Gnorp Apologue", ".hack G.U.") — using
  // the literal first character produced near-blank initials like "[" or
  // "(". Prefer the first letter/digit; fall back to the literal first
  // character only if the title has no alphanumerics at all.
  const firstAlnum = trimmed.match(/[\p{L}\p{N}]/u)?.[0];
  // codePointAt/fromCodePoint (not charAt) so a title with no letters/digits
  // at all — e.g. pure emoji — falls back to one whole glyph instead of
  // splitting a surrogate pair into a broken half-character.
  const firstCodePoint = trimmed.codePointAt(0);
  const initialSource = firstAlnum ?? (firstCodePoint ? String.fromCodePoint(firstCodePoint) : '');
  const initial = initialSource ? initialSource.toUpperCase() : '?';

  let hash = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  const hueA = hash % 360;
  const hueB = (hueA + 42) % 360;

  return { initial, hueA, hueB };
}

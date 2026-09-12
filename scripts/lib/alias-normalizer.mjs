/**
 * Read-only alias-collision detector for gameId slugs. Reports probable
 * duplicates (punctuation/hyphen/edition variants); NEVER merges anything.
 *
 * Bug history: an earlier ad-hoc version stripped ALL hyphens before
 * comparing, which silently fused adjacent roman-numeral tokens into a
 * different, unrelated numeral — e.g. "dragon-quest-i-ii-..." (tokens
 * "i" + "ii") collapsed to "...iii..." and collided with the genuinely
 * distinct "dragon-quest-iii-...". Fixed by only merging two ADJACENT pure
 * roman-numeral tokens across a hyphen boundary when they'd otherwise stay
 * un-ambiguous — i.e. never merge two roman numerals into each other; plain
 * word/digit tokens still merge normally so real collisions like
 * "pal-world" <-> "palworld" or "fallout-3" <-> "fallout3" are still caught.
 */
const PURE_ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;

export function normalizeGameSlug(id) {
  const tokens = id.toLowerCase().split(/[-\s]+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = tokens[i - 1];
    if (i > 0 && PURE_ROMAN.test(tok) && PURE_ROMAN.test(prev)) {
      out += `~${tok}`; // preserve boundary: never fuse two roman numerals into a different one
    } else {
      out += tok;
    }
  }
  return out.replace(/^the/, '');
}

/** Groups gameIds by normalized slug; returns only groups with >1 member. */
export function findAliasCollisions(gameIds) {
  const byNorm = new Map();
  for (const id of gameIds) {
    const norm = normalizeGameSlug(id);
    if (!byNorm.has(norm)) byNorm.set(norm, []);
    byNorm.get(norm).push(id);
  }
  return [...byNorm.values()].filter((group) => group.length > 1);
}

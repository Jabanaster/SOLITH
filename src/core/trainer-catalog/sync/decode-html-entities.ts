const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

/**
 * Decodes HTML/XML entities in raw text scraped from third-party listing pages
 * (regex-based, not a DOM parse, so titles like "Baldur&#x27;s Gate 3" or
 * "Persona 3&amp;4" survive as literal entity text unless decoded once here).
 * Idempotent on already-decoded input — a bare "&" with no matching entity
 * pattern is left untouched, not double-processed.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY_RE, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

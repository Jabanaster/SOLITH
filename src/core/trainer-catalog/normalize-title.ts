const MAX_TITLE_LENGTH = 200;

const HTML_TAG_RE = /<[^>]*>/g;
const HTML_ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Anchor/tag attribute soup (href="...", class="...") that survived tag-stripping —
 * a sign the source text was never real tag markup to begin with, just regex-captured
 * attribute content. Real titles do not contain `key="value"` pairs like this. */
const ATTRIBUTE_FRAGMENT_RE = /\b(?:href|src|class|style|id|data-[\w-]+|onclick)\s*=\s*["']/i;
const URL_ONLY_RE = /^https?:\/\/\S+$/i;
const NO_LETTERS_OR_DIGITS_RE = /^[^\p{L}\p{N}]+$/u;

function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_RE, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    const decoded = NAMED_ENTITIES[entity.toLowerCase()];
    return decoded ?? match;
  });
}

/**
 * Normalize a catalog display title extracted from a (possibly HTML) source.
 * Extracts text content from real tag markup, decodes entities, and collapses
 * whitespace, but rejects values that still look like raw HTML attribute
 * fragments or contain no usable text — returning null rather than storing
 * or displaying them. Never strips legitimate Unicode or punctuation.
 */
export function normalizeCatalogTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  let value = raw.replace(HTML_TAG_RE, ' ');
  value = decodeHtmlEntities(value);
  value = value.replace(/\s+/g, ' ').trim();

  if (!value || value.length < 2) return null;
  if (ATTRIBUTE_FRAGMENT_RE.test(value)) return null;
  if (URL_ONLY_RE.test(value)) return null;
  if (NO_LETTERS_OR_DIGITS_RE.test(value)) return null;

  if (value.length > MAX_TITLE_LENGTH) {
    value = value.slice(0, MAX_TITLE_LENGTH).trim();
  }

  return value;
}

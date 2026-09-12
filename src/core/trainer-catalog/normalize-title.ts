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

/**
 * Strips ASCII/Unicode control characters (code points 0-31 and 127-159 —
 * sometimes used to smuggle payloads past naive filters) without touching
 * legitimate printable Unicode. Implemented as an explicit charCode scan
 * rather than a regex literal containing control-character escapes, so this
 * source file never embeds a raw control byte itself.
 */
function stripControlCharacters(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isControlChar = (code >= 0 && code <= 31) || (code >= 127 && code <= 159);
    if (!isControlChar) result += value[i];
  }
  return result;
}

const MAX_METADATA_FIELD_LENGTH = 200;

/**
 * SOLITH Phase 3.1, Mission 8 — sanitizes provider-originated DISPLAY
 * metadata (developer, publisher, a single genre/tag string) that is stored
 * and may later be rendered, using the SAME HTML-tag-stripping/entity-decode
 * pipeline `normalizeCatalogTitle` already applies to titles, but WITHOUT
 * that function's minimum-length/no-letters-or-digits rejection rules —
 * legitimate short values (e.g. a 2-3 letter genre or studio initialism)
 * must not be dropped the way a too-short TITLE correctly would be.
 *
 * Returns null (never throws, never stores a fabricated fallback) for a
 * value that is empty after sanitization or still looks like leftover
 * HTML-attribute soup. Every provider adapter must route developer/
 * publisher/genre/tag strings through this before they reach
 * ProviderGameRecord — see tests/metadata-sanitization.test.ts for the
 * hostile-payload proof (`<script>`, `<img onerror>`, SVG payloads, entity
 * tricks, very long strings, control characters).
 */
export function sanitizeDisplayMetadata(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  let value = raw.replace(HTML_TAG_RE, ' ');
  value = decodeHtmlEntities(value);
  value = stripControlCharacters(value);
  value = value.replace(/\s+/g, ' ').trim();

  if (!value) return null;
  if (ATTRIBUTE_FRAGMENT_RE.test(value)) return null;
  if (URL_ONLY_RE.test(value)) return null;

  if (value.length > MAX_METADATA_FIELD_LENGTH) {
    value = value.slice(0, MAX_METADATA_FIELD_LENGTH).trim();
  }

  return value;
}

/** Applies sanitizeDisplayMetadata to a list of genre/tag strings, dropping any entry that sanitizes to nothing rather than storing an empty/garbage value. */
export function sanitizeDisplayMetadataList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const sanitized = sanitizeDisplayMetadata(item);
    if (sanitized) result.push(sanitized);
  }
  return result;
}

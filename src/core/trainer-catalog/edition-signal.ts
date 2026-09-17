/**
 * Edition/variant identity signal (ROADMAP.md Phase 3: "Edition / variant
 * identity"). Deliberately additive and non-authoritative: catalogGameId
 * remains the one authoritative game/edition identity (each edition that
 * genuinely needs separate trainer support already gets its own catalog
 * row today, per existing catalog data — this module does not change
 * that). Display title alone is never treated as authoritative identity
 * here — this only *surfaces* an edition signal from title text, for
 * grouping/diagnostic use (e.g. "these catalog rows look like editions of
 * the same base game"), and pairs it with executable-content-hash
 * comparison (a real, already-existing identity signal — see
 * ../executable-identity/content-hash.ts) so a caller can tell the
 * difference between "same base title, textually-different edition" and
 * "same base title, byte-identical executable" (almost certainly a
 * duplicate catalog row, not a real edition, and a data-quality signal
 * worth surfacing separately).
 *
 * Persisting a first-class `edition` column/table on trainer_catalog_games
 * is a real, separate, deliberate schema-migration decision (ROADMAP.md's
 * migration-safety requirement) and is explicitly NOT done here — this
 * stage ships the detection/grouping logic only.
 */

const EDITION_KEYWORD_RE =
  /\b(deluxe|ultimate|definitive|goty|game of the year|complete|gold|premium|collector'?s?|remastered|remaster|enhanced|anniversary|legendary|standard)\s*edition\b|\b(goty)\b/i;

export interface EditionSignal {
  /** The exact matched edition phrase, as it appeared in the title (original casing). */
  editionLabel: string;
  /** displayName with the edition phrase (and any leftover separator punctuation) removed. */
  baseTitle: string;
}

/**
 * Extracts a real "... Edition"-style suffix/phrase from a catalog display
 * name, when present. Returns undefined for a title with no detectable
 * edition keyword — never guesses a base title split without one.
 */
export function detectEditionSignal(displayName: string): EditionSignal | undefined {
  const match = EDITION_KEYWORD_RE.exec(displayName);
  if (!match) return undefined;

  const editionLabel = match[0];
  const baseTitle = displayName
    .slice(0, match.index)
    .concat(displayName.slice(match.index + editionLabel.length))
    // Trailing/leading separator punctuation left behind by removing the
    // matched phrase (": ", " - ", "(", trailing "()", etc.).
    .replace(/\s*[:\-–—(]\s*$/, '')
    .replace(/^\s*[):]\s*/, '')
    .replace(/\(\s*\)/g, '')
    .trim();

  return { editionLabel, baseTitle: baseTitle || displayName };
}

export interface CatalogEditionCandidate {
  catalogGameId: string;
  displayName: string;
  /** Real BLAKE3 content hash of a representative installed/known executable for this catalog entry, when available. */
  contentHash?: string;
}

export interface EditionGroup {
  baseTitle: string;
  members: CatalogEditionCandidate[];
  /**
   * True when 2+ members share the identical contentHash — a strong signal
   * these are not really distinct editions but duplicate/redundant catalog
   * rows for the same exact build, surfaced for review rather than acted
   * on automatically.
   */
  suspectedDuplicateContent: boolean;
}

/**
 * Groups catalog entries whose resolved base title matches — either because
 * one or both have a detected edition signal that strips to the same base
 * title (e.g. "Foo" and "Foo: Ultimate Edition"), or because two entries
 * share the exact same display name with no edition keyword on either
 * (itself a real, worth-surfacing signal: either a genuine naming
 * coincidence or a duplicate catalog row — `suspectedDuplicateContent`
 * disambiguates further via content hash). Never a fuzzy/partial title
 * match — only an exact (case-insensitive) base-title equality.
 */
export function groupCatalogEntriesByEdition(entries: CatalogEditionCandidate[]): EditionGroup[] {
  const baseTitleOf = new Map<string, string>();
  for (const entry of entries) {
    const signal = detectEditionSignal(entry.displayName);
    baseTitleOf.set(entry.catalogGameId, (signal?.baseTitle ?? entry.displayName).toLowerCase());
  }

  const groups = new Map<string, CatalogEditionCandidate[]>();
  for (const entry of entries) {
    const baseTitle = baseTitleOf.get(entry.catalogGameId)!;
    const bucket = groups.get(baseTitle) ?? [];
    bucket.push(entry);
    groups.set(baseTitle, bucket);
  }

  const result: EditionGroup[] = [];
  for (const [baseTitle, members] of groups) {
    if (members.length < 2) continue; // A lone entry is not a group of editions.
    const hashes = members.map((m) => m.contentHash).filter((h): h is string => Boolean(h));
    const suspectedDuplicateContent = new Set(hashes).size < hashes.length;
    result.push({ baseTitle, members, suspectedDuplicateContent });
  }
  return result;
}

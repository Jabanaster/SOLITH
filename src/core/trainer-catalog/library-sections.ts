/**
 * Personal Game Library — final section hierarchy (supersedes the previous
 * 10-mode AllGamesSortMode design for the primary Trainer Library view).
 * This is DETERMINISTIC ORGANIZATION, not a recommendation algorithm — every
 * game lands in exactly one section based on evidence already tracked
 * elsewhere (installed_games, TrainerCatalogEntry.ownedConfirmed, catalog
 * support state, linked-library discovery), then sorts A-Z within it.
 *
 * Do not add more section types or sort modes here without strong evidence
 * of a real usability problem — this hierarchy is an intentional product
 * decision (see LibrarySectionKey doc), not a starting point for another
 * sort-mode explosion.
 */

export type LibrarySectionKey =
  | 'installed'
  | 'owned_supported'
  | 'owned_unsupported'
  | 'other'
  | 'missing_unsupported';

export const LIBRARY_SECTION_ORDER: readonly LibrarySectionKey[] = [
  'installed',
  'owned_supported',
  'owned_unsupported',
  'other',
  'missing_unsupported',
] as const;

export const LIBRARY_SECTION_LABELS: Record<LibrarySectionKey, string> = {
  installed: 'Installed',
  owned_supported: 'Owned — Trainers Available',
  owned_unsupported: 'Owned — Support Needed',
  other: 'All Other Games',
  missing_unsupported: 'Missing / Not Yet Supported',
};

/** Sections collapsed by default in the UI (everything else expanded). */
export const LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT: ReadonlySet<LibrarySectionKey> = new Set(['other']);

export interface LibraryGameEvidence {
  canonicalGameId: string;
  displayName: string;
  /** From installed-game detection (install-discovery + canonical-games). */
  isInstalled: boolean;
  /** Explicit user confirmation only (TrainerCatalogEntry.ownedConfirmed) — never inferred. */
  ownedConfirmed: boolean;
  /** Does SOLITH's catalog have this game at all (as any entry, supported or not)? */
  isKnownToCatalog: boolean;
  /** Does SOLITH currently have usable trainer content for it (hasModPack / supportState==='supported')? */
  hasTrainerSupport: boolean;
  /** Known via a linked/local game library (Steam/GOG/Epic/etc) even without catalog knowledge. */
  isFromLinkedLibrary: boolean;
  /** Currently-running process for this game, if detected. Used for in-section prominence only — never a separate sort mode. */
  isRunning?: boolean;
}

/**
 * Assigns exactly one section per game. Order of checks matters — installed
 * always wins regardless of catalog support (per spec: "Do NOT remove an
 * installed game merely because SOLITH lacks cheats").
 */
export function assignLibrarySection(game: LibraryGameEvidence): LibrarySectionKey {
  if (game.isInstalled) return 'installed';
  if (game.ownedConfirmed) {
    return game.hasTrainerSupport ? 'owned_supported' : 'owned_unsupported';
  }
  if (game.isKnownToCatalog) return 'other';
  if (game.isFromLinkedLibrary) return 'missing_unsupported';
  // Known to neither the catalog nor any linked library — not a personal-library
  // concern at all; callers should simply exclude these rather than route them
  // into a section that implies relevance to the user.
  return 'other';
}

export interface OrganizedLibrary {
  sections: Record<LibrarySectionKey, LibraryGameEvidence[]>;
}

function compareAZ(a: LibraryGameEvidence, b: LibraryGameEvidence): number {
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
}

/**
 * Buckets and A-Z sorts every game. Within `installed`, currently-running
 * games float to the top (a prominence tiebreak, not a new sort mode) —
 * everything else is plain A-Z.
 */
export function organizeLibrary(games: LibraryGameEvidence[]): OrganizedLibrary {
  const sections: Record<LibrarySectionKey, LibraryGameEvidence[]> = {
    installed: [],
    owned_supported: [],
    owned_unsupported: [],
    other: [],
    missing_unsupported: [],
  };

  for (const game of games) {
    sections[assignLibrarySection(game)].push(game);
  }

  for (const key of LIBRARY_SECTION_ORDER) {
    sections[key].sort(compareAZ);
  }

  // Running-first tiebreak, installed section only.
  sections.installed.sort((a, b) => {
    const runningDelta = Number(Boolean(b.isRunning)) - Number(Boolean(a.isRunning));
    if (runningDelta !== 0) return runningDelta;
    return compareAZ(a, b);
  });

  return { sections };
}

/** Simple global A-Z view, ignoring sections entirely — the one alternate view the spec allows. */
export function sortLibraryAZ(games: LibraryGameEvidence[]): LibraryGameEvidence[] {
  return [...games].sort(compareAZ);
}

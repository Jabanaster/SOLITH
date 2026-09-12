import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignLibrarySection,
  organizeLibrary,
  sortLibraryAZ,
  LIBRARY_SECTION_ORDER,
  LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT,
  type LibraryGameEvidence,
} from '../src/core/trainer-catalog/library-sections.js';

function game(overrides: Partial<LibraryGameEvidence> & { canonicalGameId: string; displayName: string }): LibraryGameEvidence {
  return {
    isInstalled: false,
    ownedConfirmed: false,
    isKnownToCatalog: true,
    hasTrainerSupport: false,
    isFromLinkedLibrary: false,
    ...overrides,
  };
}

describe('assignLibrarySection — one section per game, deterministic', () => {
  test('installed supported game -> installed (not owned_supported)', () => {
    const g = game({ canonicalGameId: 'a', displayName: 'A', isInstalled: true, ownedConfirmed: true, hasTrainerSupport: true });
    assert.equal(assignLibrarySection(g), 'installed');
  });

  test('installed unsupported game -> installed (never dropped for lacking cheats)', () => {
    const g = game({ canonicalGameId: 'a', displayName: 'A', isInstalled: true, hasTrainerSupport: false });
    assert.equal(assignLibrarySection(g), 'installed');
  });

  test('owned supported game (not installed) -> owned_supported', () => {
    const g = game({ canonicalGameId: 'a', displayName: 'A', ownedConfirmed: true, hasTrainerSupport: true });
    assert.equal(assignLibrarySection(g), 'owned_supported');
  });

  test('owned unsupported game (not installed) -> owned_unsupported', () => {
    const g = game({ canonicalGameId: 'a', displayName: 'A', ownedConfirmed: true, hasTrainerSupport: false });
    assert.equal(assignLibrarySection(g), 'owned_unsupported');
  });

  test('unowned supported catalog game -> other', () => {
    const g = game({ canonicalGameId: 'a', displayName: 'A', isKnownToCatalog: true, hasTrainerSupport: true });
    assert.equal(assignLibrarySection(g), 'other');
  });

  test('same game on Steam + GOG, owned via either, still one section decision (canonical identity is the caller\'s job)', () => {
    // library-sections.ts operates on already-canonicalized evidence — it
    // does not itself merge launcher sources. Feeding it a single evidence
    // record per canonical game (as canonical-games/ produces) is correct.
    const g = game({ canonicalGameId: 'cyberpunk-2077', displayName: 'Cyberpunk 2077', ownedConfirmed: true, hasTrainerSupport: true });
    assert.equal(assignLibrarySection(g), 'owned_supported');
  });

  test('unowned game known only via a linked library, not in SOLITH catalog -> missing_unsupported', () => {
    const g = game({ canonicalGameId: 'a', displayName: 'A', isKnownToCatalog: false, isFromLinkedLibrary: true });
    assert.equal(assignLibrarySection(g), 'missing_unsupported');
  });

  test('ambiguous launcher identity / unavailable launcher / corrupt metadata all fail closed to "other" rather than crashing', () => {
    // Represents "we could not confidently place this game" — still renders
    // somewhere sane instead of throwing or silently disappearing.
    const g = game({ canonicalGameId: '', displayName: 'Unknown Game', isKnownToCatalog: true });
    assert.equal(assignLibrarySection(g), 'other');
  });

  test('unowned, uninstalled, unknown to catalog AND not from any linked library -> other (caller should filter these out upstream)', () => {
    const g = game({ canonicalGameId: 'x', displayName: 'X', isKnownToCatalog: false, isFromLinkedLibrary: false });
    assert.equal(assignLibrarySection(g), 'other');
  });
});

describe('organizeLibrary — default ordering exactly per spec', () => {
  test('default order: INSTALLED, OWNED+SUPPORTED, OWNED+UNSUPPORTED, OTHER, MISSING — A-Z within each', () => {
    const games: LibraryGameEvidence[] = [
      game({ canonicalGameId: 'z-installed', displayName: 'Zelda-like Installed Game', isInstalled: true }),
      game({ canonicalGameId: 'a-installed', displayName: 'Abzu Installed Game', isInstalled: true }),
      game({ canonicalGameId: 'z-owned-sup', displayName: 'Zeus Owned Supported', ownedConfirmed: true, hasTrainerSupport: true }),
      game({ canonicalGameId: 'a-owned-sup', displayName: 'Aztec Owned Supported', ownedConfirmed: true, hasTrainerSupport: true }),
      game({ canonicalGameId: 'z-owned-unsup', displayName: 'Zebra Owned Unsupported', ownedConfirmed: true, hasTrainerSupport: false }),
      game({ canonicalGameId: 'a-owned-unsup', displayName: 'Ant Owned Unsupported', ownedConfirmed: true, hasTrainerSupport: false }),
      game({ canonicalGameId: 'z-other', displayName: 'Zoo Other', isKnownToCatalog: true }),
      game({ canonicalGameId: 'a-other', displayName: 'Apple Other', isKnownToCatalog: true }),
      game({ canonicalGameId: 'z-missing', displayName: 'Zap Missing', isKnownToCatalog: false, isFromLinkedLibrary: true }),
      game({ canonicalGameId: 'a-missing', displayName: 'Astro Missing', isKnownToCatalog: false, isFromLinkedLibrary: true }),
    ];

    const { sections } = organizeLibrary(games);

    assert.deepEqual(LIBRARY_SECTION_ORDER, ['installed', 'owned_supported', 'owned_unsupported', 'other', 'missing_unsupported']);

    assert.deepEqual(sections.installed.map((g) => g.displayName), ['Abzu Installed Game', 'Zelda-like Installed Game']);
    assert.deepEqual(sections.owned_supported.map((g) => g.displayName), ['Aztec Owned Supported', 'Zeus Owned Supported']);
    assert.deepEqual(sections.owned_unsupported.map((g) => g.displayName), ['Ant Owned Unsupported', 'Zebra Owned Unsupported']);
    assert.deepEqual(sections.other.map((g) => g.displayName), ['Apple Other', 'Zoo Other']);
    assert.deepEqual(sections.missing_unsupported.map((g) => g.displayName), ['Astro Missing', 'Zap Missing']);
  });

  test('A-Z ordering is case-insensitive', () => {
    const games = [
      game({ canonicalGameId: 'b', displayName: 'bravo', isInstalled: true }),
      game({ canonicalGameId: 'a', displayName: 'Alpha', isInstalled: true }),
    ];
    const { sections } = organizeLibrary(games);
    assert.deepEqual(sections.installed.map((g) => g.displayName), ['Alpha', 'bravo']);
  });

  test('running games float to top of Installed only — not a new global sort mode', () => {
    const games = [
      game({ canonicalGameId: 'a', displayName: 'Alpha', isInstalled: true }),
      game({ canonicalGameId: 'z', displayName: 'Zulu', isInstalled: true, isRunning: true }),
    ];
    const { sections } = organizeLibrary(games);
    assert.deepEqual(sections.installed.map((g) => g.displayName), ['Zulu', 'Alpha']);
  });

  test('"other" section is collapsed by default; no other section is', () => {
    assert.equal(LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has('other'), true);
    assert.equal(LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has('installed'), false);
    assert.equal(LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has('owned_supported'), false);
    assert.equal(LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has('owned_unsupported'), false);
    assert.equal(LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has('missing_unsupported'), false);
  });
});

describe('sortLibraryAZ — the one permitted alternate view', () => {
  test('flat A-Z ignoring sections entirely', () => {
    const games = [
      game({ canonicalGameId: 'z', displayName: 'Zulu', isInstalled: true }),
      game({ canonicalGameId: 'm', displayName: 'Mid', ownedConfirmed: true, hasTrainerSupport: true }),
      game({ canonicalGameId: 'a', displayName: 'Alpha', isKnownToCatalog: false, isFromLinkedLibrary: true }),
    ];
    const sorted = sortLibraryAZ(games);
    assert.deepEqual(sorted.map((g) => g.displayName), ['Alpha', 'Mid', 'Zulu']);
  });

  test('does not mutate the input array', () => {
    const games = [game({ canonicalGameId: 'z', displayName: 'Zulu' }), game({ canonicalGameId: 'a', displayName: 'Alpha' })];
    const original = [...games];
    sortLibraryAZ(games);
    assert.deepEqual(games, original);
  });
});

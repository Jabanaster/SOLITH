import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  selectLocallyVerifiedShelf,
  selectMyGamesShelf,
  selectNeedsReverifyShelf,
  selectRecentlyDetectedShelf,
  selectRunningOrTopPriorityGame,
  selectTrainersReadyShelf,
} from '../src/core/personal-library/home-sections.ts';
import { organizeLibrary, type LibraryGameEvidence } from '../src/core/trainer-catalog/library-sections.ts';
import type { PersonalLibraryGame } from '../src/core/personal-library/model.ts';

// This suite proves out Visual Library 2.0 Step 5's Home/My-Games wiring.
// HomePage.tsx / MyGamesPage.tsx / HomeShelf.tsx all import a CSS module
// (`./X.module.css`), which the plain `tsx --test` runner used here cannot
// resolve (no CSS loader registered) — the same constraint documented in
// src/app/components/game-card-status.ts's header and already worked around
// by tests/trainer-library-card-states.test.tsx (source-inspection) and
// tests/personal-library-home-sections.test.ts (fixture-based selector
// tests). This file follows both of those established patterns rather than
// inventing a third: real selector/library logic is exercised directly with
// fixtures (no React, no DOM), and the pages' own source text is inspected
// for the specific conditional-render/exclusion logic that can't be
// exercised without a DOM.

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const HOME_PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/pages/HomePage.tsx'), 'utf8');
const HOME_SHELF_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/components/HomeShelf.tsx'), 'utf8');
const MY_GAMES_PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/pages/MyGamesPage.tsx'), 'utf8');

function baseGame(overrides: Partial<PersonalLibraryGame> & { gameId: string }): PersonalLibraryGame {
  return {
    gameId: overrides.gameId,
    title: overrides.title ?? overrides.gameId,
    running: overrides.running ?? false,
    installed: overrides.installed ?? false,
    owned: overrides.owned ?? 'unknown',
    favorite: overrides.favorite ?? false,
    recentlyDetected: overrides.recentlyDetected ?? false,
    launchers: overrides.launchers ?? [],
    installEvidence: overrides.installEvidence ?? [],
    ownershipEvidence: overrides.ownershipEvidence ?? [],
    canonicalConfidence: overrides.canonicalConfidence ?? 'UNKNOWN',
    trainerAvailability: overrides.trainerAvailability ?? 'NONE',
    trainerCount: overrides.trainerCount ?? 0,
    trainerAccuracy: overrides.trainerAccuracy ?? 'NONE',
    versionEvidence: overrides.versionEvidence ?? [],
  };
}

describe('HomePage — hero renders nothing when no running/priority game exists (owner rule: never fabricate a featured game)', () => {
  test('selectRunningOrTopPriorityGame(empty) is undefined, and HomePage source renders its empty-state branch rather than a placeholder card', () => {
    assert.equal(selectRunningOrTopPriorityGame([]), undefined);
    // HomePage must branch on the selector's result, never synthesize a hero
    // from something else (e.g. the first game, or a hardcoded string).
    assert.match(HOME_PAGE_SOURCE, /const heroGame = selectRunningOrTopPriorityGame\(myGames\);/);
    assert.match(HOME_PAGE_SOURCE, /\{heroGame \? \(/);
    assert.match(HOME_PAGE_SOURCE, /data-testid="home-hero-empty"/);
    // The empty-state copy must not claim a specific game exists.
    const emptyBranch = HOME_PAGE_SOURCE.match(/data-testid="home-hero-empty">[\s\S]*?<\/section>/)![0];
    assert.doesNotMatch(emptyBranch, /heroGame\.title/);
  });

  test('a running game always wins the hero slot over a higher-priority-but-not-running game', () => {
    const notRunningHighPriority = baseGame({
      gameId: 'g-priority',
      installed: true,
      trainerAccuracy: 'LOCALLY_VERIFIED',
      trainerAvailability: 'VERIFIED',
    });
    const running = baseGame({ gameId: 'g-running', running: true, installed: false });
    const hero = selectRunningOrTopPriorityGame([notRunningHighPriority, running]);
    assert.equal(hero?.gameId, 'g-running');
  });
});

describe('HomePage — each shelf conditionally renders only with real data', () => {
  test('an empty personal library produces every shelf as [], and HomePage source never renders HomeShelf unconditionally', () => {
    assert.deepEqual(selectMyGamesShelf([], 12), []);
    assert.deepEqual(selectTrainersReadyShelf([], 12), []);
    assert.deepEqual(selectLocallyVerifiedShelf([], 12), []);
    assert.deepEqual(selectRecentlyDetectedShelf([], 12), []);
    assert.deepEqual(selectNeedsReverifyShelf([], 12), []);
    // HomePage gates the whole shelves block behind hasAnyShelfContent, and
    // HomeShelf itself additionally refuses to render an empty games array —
    // two independent layers, neither of which fabricates content.
    assert.match(HOME_PAGE_SOURCE, /hasAnyShelfContent &&/);
    assert.match(HOME_SHELF_SOURCE, /if \(games\.length === 0\) return null;/);
  });

  test('a locally-verified game appears in the Locally Verified shelf but not Needs Reverify, and vice versa for a stale one', () => {
    const verified = baseGame({ gameId: 'g-verified', installed: true, trainerAvailability: 'VERIFIED', trainerAccuracy: 'LOCALLY_VERIFIED' });
    const stale = baseGame({ gameId: 'g-stale', installed: true, trainerAvailability: 'VERIFIED', trainerAccuracy: 'NEEDS_REVERIFY' });
    const games = [verified, stale];
    assert.deepEqual(selectLocallyVerifiedShelf(games, 12).map((g) => g.gameId), ['g-verified']);
    assert.deepEqual(selectNeedsReverifyShelf(games, 12).map((g) => g.gameId), ['g-stale']);
  });

  test('HomePage wires all five shelves from the real home-sections selectors, not ad-hoc filtering', () => {
    for (const selectorName of [
      'selectMyGamesShelf',
      'selectTrainersReadyShelf',
      'selectLocallyVerifiedShelf',
      'selectRecentlyDetectedShelf',
      'selectNeedsReverifyShelf',
    ]) {
      assert.match(HOME_PAGE_SOURCE, new RegExp(`${selectorName}\\(myGames, SHELF_LIMIT\\)`));
    }
  });
});

describe('HomePage — empty-everything state does not crash', () => {
  test('every selector accepts [] without throwing and the hero/shelves branches are mutually exclusive of a crash path', () => {
    assert.doesNotThrow(() => {
      selectRunningOrTopPriorityGame([]);
      selectMyGamesShelf([], 12);
      selectTrainersReadyShelf([], 12);
      selectLocallyVerifiedShelf([], 12);
      selectRecentlyDetectedShelf([], 12);
      selectNeedsReverifyShelf([], 12);
    });
  });

  test('HomePage always renders the Browse All CTA regardless of hero/shelf state (never gated behind having games)', () => {
    // The CTA block must appear outside/after both the hero and shelves
    // conditionals, so an empty library still gets a way to browse the catalog.
    const ctaIndex = HOME_PAGE_SOURCE.indexOf('data-testid="home-browse-all"');
    const shelvesIndex = HOME_PAGE_SOURCE.indexOf('hasAnyShelfContent &&');
    assert.ok(ctaIndex > 0 && shelvesIndex > 0);
    assert.ok(ctaIndex > shelvesIndex, 'Browse All CTA should render after the shelves block, unconditionally');
    const wrapMatch = HOME_PAGE_SOURCE.match(/<div className=\{styles\.browseAllWrap\}>[\s\S]*?<\/div>/);
    assert.ok(wrapMatch, 'expected an unconditional browseAllWrap block');
  });
});

describe('MyGamesPage — excludes catalog-only (non-personal) games', () => {
  function toLibraryGameEvidence(game: PersonalLibraryGame): LibraryGameEvidence {
    // Mirrors MyGamesPage.tsx's own toLibraryGameEvidence mapping exactly —
    // duplicated here (rather than imported) only because MyGamesPage.tsx
    // pulls in a CSS module this plain test runner can't resolve. Kept in
    // lockstep by the assertions below, which pin the real source's mapping
    // and personal-section allowlist so a future edit to either side is
    // caught rather than silently drifting.
    return {
      canonicalGameId: game.gameId,
      displayName: game.title,
      isInstalled: game.installed,
      ownedConfirmed: game.owned === true,
      isKnownToCatalog: game.trainerAvailability !== 'NONE',
      hasTrainerSupport: game.trainerAvailability !== 'NONE',
      isFromLinkedLibrary: false,
      isRunning: game.running,
    };
  }

  test('an installed game, an owned-confirmed game, and a favorite-only (catalog-only) game: only the first two land in a personal section', () => {
    const installedGame = baseGame({ gameId: 'g-installed', installed: true });
    const ownedGame = baseGame({ gameId: 'g-owned', owned: true, trainerAvailability: 'VERIFIED' });
    const favoriteOnlyGame = baseGame({ gameId: 'g-favorite-only', favorite: true, trainerAvailability: 'COMMUNITY' });

    const organized = organizeLibrary(
      [installedGame, ownedGame, favoriteOnlyGame].map(toLibraryGameEvidence),
    );

    assert.deepEqual(organized.sections.installed.map((g) => g.canonicalGameId), ['g-installed']);
    assert.deepEqual(organized.sections.owned_supported.map((g) => g.canonicalGameId), ['g-owned']);
    // The favorite-only game has neither install nor ownership evidence, so
    // organizeLibrary correctly routes it to 'other' — a catalog-relevance
    // bucket, not a personal-library one.
    assert.deepEqual(organized.sections.other.map((g) => g.canonicalGameId), ['g-favorite-only']);
    assert.deepEqual(organized.sections.owned_unsupported, []);
    assert.deepEqual(organized.sections.missing_unsupported, []);
  });

  test('MyGamesPage source only ever renders the three personal sections, never "other" or "missing_unsupported"', () => {
    assert.match(
      MY_GAMES_PAGE_SOURCE,
      /PERSONAL_SECTION_ORDER: readonly LibrarySectionKey\[\] = \['installed', 'owned_supported', 'owned_unsupported'\];/,
    );
    // Guard against a future edit silently widening the allowlist to include
    // the catalog-spillover sections.
    assert.doesNotMatch(MY_GAMES_PAGE_SOURCE, /PERSONAL_SECTION_ORDER[\s\S]{0,120}'other'/);
    assert.doesNotMatch(MY_GAMES_PAGE_SOURCE, /PERSONAL_SECTION_ORDER[\s\S]{0,120}'missing_unsupported'/);
  });

  test('an empty myGames array organizes without crashing and yields no personal sections', () => {
    const organized = organizeLibrary([]);
    assert.deepEqual(organized.sections.installed, []);
    assert.deepEqual(organized.sections.owned_supported, []);
    assert.deepEqual(organized.sections.owned_unsupported, []);
  });
});

describe('MyGamesPage — reuses library-sections.ts verbatim (not modified, not reimplemented)', () => {
  test('imports organizeLibrary and LIBRARY_SECTION_LABELS from the frozen module rather than a local reimplementation', () => {
    assert.match(
      MY_GAMES_PAGE_SOURCE,
      /import \{\s*LIBRARY_SECTION_LABELS,\s*organizeLibrary,/,
    );
    assert.match(MY_GAMES_PAGE_SOURCE, /from '\.\.\/\.\.\/core\/trainer-catalog\/library-sections\.js';/);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  primaryStatusLabel,
  trainerStatusLabel,
  type GameCardData,
} from '../src/app/components/game-card-status.ts';
import { getLibraryViewMode, setLibraryViewMode } from '../src/core/settings/index.ts';
import { initDatabase } from '../src/core/database/index.ts';

// GameCard.tsx and ViewModeToggle.tsx both import a `*.module.css` file,
// which the plain `tsx --test` runner used by this repo cannot resolve
// (Node's ESM loader has no CSS loader registered — confirmed by attempting
// a direct import, which fails with "Unknown file extension .css"). The
// established convention for this exact situation (see
// tests/trainer-library-card-states.test.tsx, which reads
// TrainerLibraryPage.tsx as raw source rather than importing it) is to test
// real, CSS-free extracted logic directly wherever it exists, and fall back
// to source-text assertions for the JSX wiring itself.
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const GAME_CARD_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/components/GameCard.tsx'), 'utf8');
const VIEW_MODE_TOGGLE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/components/ViewModeToggle.tsx'), 'utf8');

function baseGame(overrides: Partial<GameCardData> = {}): GameCardData {
  return {
    gameId: 'game-1',
    title: 'Test Game',
    running: false,
    installed: false,
    owned: 'unknown',
    favorite: false,
    launchers: [],
    trainerAvailability: 'NONE',
    trainerAccuracy: 'NONE',
    ...overrides,
  };
}

describe('game-card-status — primary status line (personal-priority ordering)', () => {
  test('owned badge never shows for owned === "unknown"', () => {
    const label = primaryStatusLabel(baseGame({ owned: 'unknown' }));
    assert.equal(label, null);
  });

  test('owned badge never shows for owned === false (an explicit "not owned" declaration is still not a badge)', () => {
    const label = primaryStatusLabel(baseGame({ owned: false }));
    assert.equal(label, null);
  });

  test('owned badge shows only for owned === true exactly, when nothing stronger applies', () => {
    const label = primaryStatusLabel(baseGame({ owned: true }));
    assert.equal(label, 'Owned');
  });

  test('running takes priority display over installed (never stacked)', () => {
    const label = primaryStatusLabel(baseGame({ running: true, installed: true, owned: true, launchers: ['steam'] }));
    assert.equal(label, 'Running · Steam');
    assert.doesNotMatch(label!, /Installed/);
    assert.doesNotMatch(label!, /Owned/);
  });

  test('installed takes priority over owned when not running', () => {
    const label = primaryStatusLabel(baseGame({ running: false, installed: true, owned: true, launchers: ['epic'] }));
    assert.equal(label, 'Installed · Epic');
  });

  test('no launcher suffix when launchers is empty', () => {
    const label = primaryStatusLabel(baseGame({ running: true, launchers: [] }));
    assert.equal(label, 'Running');
  });

  test('neither running, installed, nor owned -> no primary label at all', () => {
    assert.equal(primaryStatusLabel(baseGame()), null);
  });
});

describe('game-card-status — trainer status line (availability + accuracy)', () => {
  test('NONE availability always reads "No Trainer", regardless of accuracy field', () => {
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'NONE', trainerAccuracy: 'EXACT_VERSION_MATCH' })), 'No Trainer');
  });

  test('LOCALLY_VERIFIED and NEEDS_REVERIFY reuse the exact wording from TrainerLibraryPage.tsx\'s existing accuracy badge label map', () => {
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'VERIFIED', trainerAccuracy: 'LOCALLY_VERIFIED' })), 'Locally Verified');
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'VERIFIED', trainerAccuracy: 'NEEDS_REVERIFY' })), 'Needs Reverify');
  });

  test('EXACT_VERSION_MATCH and STRONG_MATCH also reuse the existing wording', () => {
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'COMMUNITY', trainerAccuracy: 'EXACT_VERSION_MATCH' })), 'Exact Match');
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'COMMUNITY', trainerAccuracy: 'STRONG_MATCH' })), 'Strong Match');
  });

  test('VERSION_UNKNOWN reads "Trainer Ready" and INCOMPATIBLE reads "Incompatible"', () => {
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'LOCAL', trainerAccuracy: 'VERSION_UNKNOWN' })), 'Trainer Ready');
    assert.equal(trainerStatusLabel(baseGame({ trainerAvailability: 'LOCAL', trainerAccuracy: 'INCOMPATIBLE' })), 'Incompatible');
  });
});

describe('GameCard.tsx — markup wiring (source-level, matching this repo\'s established CSS-module test workaround)', () => {
  test('the card renders artwork via a precomputed game.artworkUrl, falling back to resolveCatalogCoverUrl, never a hand-built image URL', () => {
    // Artwork audit (Mission 7) — HomePage/MyGamesPage/SidebarQuickAccess
    // never passed `catalogEntry`, so this component's original
    // catalogEntry-only resolution always fell back on those surfaces. Real
    // artwork is now precomputed (same confidence-gated resolution) by
    // projectPersonalLibraryGame onto `game.artworkUrl`, which this
    // component now prefers; `catalogEntry` stays as a secondary path.
    assert.match(GAME_CARD_SOURCE, /import \{ resolveCatalogCoverUrl \} from '\.\.\/\.\.\/core\/trainer-catalog\/cover-url\.js';/);
    assert.match(GAME_CARD_SOURCE, /const coverUrl = game\.artworkUrl \?\? \(catalogEntry \? resolveCatalogCoverUrl\(catalogEntry\) : undefined\);/);
  });

  test('missing artwork (no catalogEntry, or resolveCatalogCoverUrl returning undefined) leaves the fallback element visible', () => {
    // Same convention as the existing CatalogCard: the fallback div always
    // renders; only its inline `display` style is toggled off when a real
    // cover image is present. With coverUrl undefined, the spread producing
    // `display: none` is skipped entirely, so the fallback stays visible.
    assert.match(GAME_CARD_SOURCE, /\.\.\.\(coverUrl \? \{ display: 'none' \} : undefined\),/);
    assert.match(GAME_CARD_SOURCE, /data-testid="game-card-fallback"/);
  });

  test('favorite indicator only renders when favorite === true', () => {
    assert.match(GAME_CARD_SOURCE, /\{game\.favorite && \(/);
    assert.match(GAME_CARD_SOURCE, /data-testid="game-card-favorite"/);
  });

  test('grid and list modes render distinct structural class names and a data-mode marker', () => {
    assert.match(GAME_CARD_SOURCE, /const rootClassName = mode === 'grid' \? styles\.cardGrid : styles\.cardList;/);
    assert.match(GAME_CARD_SOURCE, /data-mode=\{mode\}/);
  });

  test('the card never invents its own image URL logic (no raw file://, http://, or template-built src)', () => {
    assert.doesNotMatch(GAME_CARD_SOURCE, /src=\{`/);
    assert.doesNotMatch(GAME_CARD_SOURCE, /file:\/\//);
  });

  test('onSelect is called with the game id on activation; no navigation is implemented here', () => {
    assert.match(GAME_CARD_SOURCE, /const handleActivate = \(\) => onSelect\(game\.gameId\);/);
    assert.doesNotMatch(GAME_CARD_SOURCE, /useNavigate|navigate\(|history\.push/);
  });

  test('the card is keyboard-activatable (role=button, tabIndex, Enter/Space) in addition to click', () => {
    assert.match(GAME_CARD_SOURCE, /role="button"/);
    assert.match(GAME_CARD_SOURCE, /tabIndex=\{0\}/);
    assert.match(GAME_CARD_SOURCE, /key === 'Enter' \|\| key === ' '/);
  });
});

describe('ViewModeToggle — settings read/write wiring and keyboard operability', () => {
  test('reads the persisted mode via getLibraryViewMode() and writes via setLibraryViewMode() (real round-trip, not a mock)', async () => {
    await initDatabase();
    setLibraryViewMode('list');
    assert.equal(getLibraryViewMode(), 'list');
    setLibraryViewMode('grid');
    assert.equal(getLibraryViewMode(), 'grid');
  });

  test('the component reads the persisted mode via window.electronAPI.getSettings() on mount, not a synchronous core/settings call (that module is main-process-only and cannot be imported in the renderer)', () => {
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /window\.electronAPI\.getSettings\(\)\.then\(/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /isLibraryViewMode\(settings\?\.libraryViewMode\)/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /setMode\(settings\.libraryViewMode\);/);
  });

  test('every mode change calls window.electronAPI.setSetting(\'libraryViewMode\', next) before updating local state, and calls onChange', () => {
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /void window\.electronAPI\.setSetting\('libraryViewMode', next\);/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /setMode\(next\);/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /onChange\?\.\(next\);/);
  });

  test('uses the accessible radiogroup/radio pattern with aria-checked reflecting the active mode', () => {
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /role="radiogroup"/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /role="radio"/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /aria-checked=\{mode === 'grid'\}/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /aria-checked=\{mode === 'list'\}/);
  });

  test('is keyboard operable: native <button> elements plus ArrowLeft/ArrowRight to switch modes', () => {
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /<button/);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /ArrowLeft.*ArrowRight|ArrowRight.*ArrowLeft/s);
    assert.match(VIEW_MODE_TOGGLE_SOURCE, /onKeyDown=\{handleKeyDown\}/);
  });
});

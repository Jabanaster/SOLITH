import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fallbackArtworkTreatment } from '../src/app/pages/trainer-card-fallback-artwork.ts';

/**
 * GameDetailPage — Visual Library 2.0, Step 7.
 *
 * Follows this repo's established source-inspection/fixture pattern for
 * components that import a `.module.css` file (see module-artwork.test.ts
 * and trainer-library-card-states.test.tsx's header comments): Node's plain
 * `tsx --test` runner has no CSS loader registered, so components importing
 * a CSS module cannot be rendered directly here. Behavior is instead
 * verified against the real source text of the component + its callers,
 * plus direct unit tests of any CSS-free pure logic it uses.
 */

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

const GAME_DETAIL_PAGE = readSource('src/app/pages/GameDetailPage.tsx');
const DETAIL_BANNER = readSource('src/app/components/game-detail/DetailBanner.tsx');
const TRAINER_SECTION = readSource('src/app/components/game-detail/TrainerSection.tsx');
const GAME_INFO_SECTION = readSource('src/app/components/game-detail/GameInfoSection.tsx');
const TRAINER_SOURCES_SECTION = readSource('src/app/components/game-detail/TrainerSourcesSection.tsx');
const APP_TSX = readSource('src/app/App.tsx');

describe('GameDetailPage — no fabricated actions render when their IPC does not exist', () => {
  test('Open Game Folder is wired to the real installDiscoveryOpenPath IPC, gated on game.installed', () => {
    assert.match(GAME_DETAIL_PAGE, /api\.installDiscoveryOpenPath\(\{\s*catalogGameId:\s*gameId\s*\}\)/);
    assert.match(DETAIL_BANNER, /canOpenFolder\s*=\s*game\.installed/);
  });

  test('Open Trainer is pure navigation to the existing live-memory view, never a live-memory/process-attach call', () => {
    assert.match(DETAIL_BANNER, /canOpenTrainer\s*=\s*game\.trainerAvailability\s*!==\s*'NONE'/);
    assert.match(GAME_DETAIL_PAGE, /onOpenTrainer\(game\.gameId\)/);
    // Never calls liveMemoryAttach/liveMemoryScan*/liveMemoryProposeWrite or
    // any other live-memory mutation API from this page or its banner.
    assert.doesNotMatch(GAME_DETAIL_PAGE, /liveMemory(Attach|ScanFirst|ProposeWrite|Confirm|Freeze)/);
    assert.doesNotMatch(DETAIL_BANNER, /liveMemory(Attach|ScanFirst|ProposeWrite|Confirm|Freeze)/);
  });

  test('no Play/Launch Game action exists anywhere in the page or its banner (launchInstallation starts the game exe — forbidden this step)', () => {
    for (const source of [GAME_DETAIL_PAGE, DETAIL_BANNER]) {
      assert.doesNotMatch(source, /api\.launchInstallation/);
      // No rendered button/label text reading "Play" or "Launch Game" —
      // checked as a JSX/string-literal button label, not prose in comments
      // (this file's own header comments discuss the audited gap in words).
      assert.doesNotMatch(source, />\s*Play\s*</);
      assert.doesNotMatch(source, />\s*Launch Game\s*</i);
    }
  });

  test('the audit findings are documented in the page header, including the confirmed Play/Launch gap', () => {
    assert.match(GAME_DETAIL_PAGE, /launch-installation/);
    assert.match(GAME_DETAIL_PAGE, /HARD RULE/);
  });
});

describe('GameDetailPage — missing fields render Unknown rather than being fabricated', () => {
  test('GameInfoSection falls back to a shared UNKNOWN constant for every field, never an empty string or guess', () => {
    assert.match(GAME_INFO_SECTION, /const UNKNOWN = 'Unknown'/);
    const fields = ['Version', 'Executable path', 'Install path', 'Launcher', 'Last detected'];
    for (const field of fields) {
      assert.match(GAME_INFO_SECTION, new RegExp(`label:\\s*'${field}'`));
    }
    // Every value expression falls back to UNKNOWN via `?? UNKNOWN` or a
    // ternary — never a bare fabricated default.
    assert.doesNotMatch(GAME_INFO_SECTION, /value:\s*install\?\.[a-zA-Z]+,/);
  });

  test('TrainerSourcesSection omits itself entirely (returns null) when there is no catalog entry or no real sources', () => {
    assert.match(TRAINER_SOURCES_SECTION, /if \(!entry \|\| entry\.sources\.length === 0\) return null;/);
  });

  test('the game-not-found state renders an honest message instead of a blank/fabricated page', () => {
    assert.match(GAME_DETAIL_PAGE, /no longer in your library/);
  });
});

describe('GameDetailPage — accuracy and trainer-source sections use real data only', () => {
  test('TrainerSection reads trainerCount/trainerAvailability/trainerAccuracy straight off the real PersonalLibraryGame record', () => {
    assert.match(TRAINER_SECTION, /game\.trainerCount/);
    assert.match(TRAINER_SECTION, /game\.trainerAvailability/);
    assert.match(TRAINER_SECTION, /game\.trainerAccuracy/);
    // No hardcoded cheat list or fabricated accuracy value.
    assert.doesNotMatch(TRAINER_SECTION, /trainerAccuracy:\s*'LOCALLY_VERIFIED'/);
  });

  test('TrainerSourcesSection renders the real sources array and verification tier from the catalog entry, not an invented breakdown', () => {
    assert.match(TRAINER_SOURCES_SECTION, /entry\.sources\.map/);
    assert.match(TRAINER_SOURCES_SECTION, /entry\.verificationStatus/);
  });

  test('GameDetailPage fetches the catalog entry via the real trainerCatalogGet IPC, keyed by this game\'s real id', () => {
    assert.match(GAME_DETAIL_PAGE, /api\.trainerCatalogGet\(\{ catalogGameId: gameId \}\)/);
  });
});

describe('GameDetailPage — back navigation', () => {
  test('the back button calls the onBack prop directly', () => {
    assert.match(GAME_DETAIL_PAGE, /onClick=\{onBack\}/);
  });

  test('App.tsx wires the game-detail case to a real GameDetailPage, returning back to wherever the selection originated', () => {
    assert.match(APP_TSX, /import GameDetailPage from '\.\/pages\/GameDetailPage\.js';/);
    assert.match(APP_TSX, /<GameDetailPage/);
    // Discovery Master Pass, Stage 2 fix: back-navigation used to hardcode
    // 'home' regardless of where the selection came from, which was a real
    // return-navigation bug for Discovery -> card -> detail -> Back. It now
    // returns to gameDetailOrigin, captured at selection time.
    assert.match(APP_TSX, /onBack=\{\(\) => setCurrentView\(gameDetailOrigin\)\}/);
    assert.match(APP_TSX, /setGameDetailOrigin\(currentView\)/);
    assert.match(APP_TSX, /onOpenTrainer=\{openLiveTrainerFromDeck\}/);
    // The placeholder text must be gone.
    assert.doesNotMatch(APP_TSX, /Game Detail \(coming soon\)/);
  });
});

describe('GameDetailPage — save management section is deliberately omitted (audited gap)', () => {
  test('no getBackups/restoreBackup call exists anywhere in the new page or its sub-components (legacy Game Library id space, no mapping to canonical gameId)', () => {
    for (const source of [DETAIL_BANNER, TRAINER_SECTION, GAME_INFO_SECTION, TRAINER_SOURCES_SECTION]) {
      assert.doesNotMatch(source, /getBackups/);
      assert.doesNotMatch(source, /restoreBackup/);
    }
    // GameDetailPage.tsx's own header comment documents the audited gap in
    // prose (mentions the IPC names by way of explanation) but must never
    // actually call either API.
    assert.doesNotMatch(GAME_DETAIL_PAGE, /api\.getBackups/);
    assert.doesNotMatch(GAME_DETAIL_PAGE, /api\.restoreBackup/);
  });
});

describe('fallbackArtworkTreatment (real, pure logic reused by DetailBanner for missing artwork)', () => {
  test('is deterministic per title', () => {
    const a = fallbackArtworkTreatment('Elden Ring');
    const b = fallbackArtworkTreatment('Elden Ring');
    assert.deepEqual(a, b);
  });

  test('DetailBanner reuses this exact helper rather than a new invented one', () => {
    assert.match(DETAIL_BANNER, /fallbackArtworkTreatment\(game\.title\)/);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_MODULE_ARTWORK, SECTION_ARTWORK } from '../src/app/assets/branding/module-artwork.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

describe('sidebar module artwork mapping', () => {
  test('custom nav artwork matches the current nav grouping', () => {
    assert.deepEqual(NAV_MODULE_ARTWORK, {
      library: 'gameLibraryControllerMonitors',
      'trainer-library': 'trainerLibraryStopwatchClipboard',
      'linked-libraries': 'gameLibraryControllerMonitors',
      'ct-library': 'hoodedProfile',
      trainer: 'trainerController',
      saves: 'saveTools',
      controls: 'saveTools',
      journal: 'recoveryPhoenix',
      locations: 'recoveryPhoenix',
      community: 'recoveryPhoenix',
      'discovery-lab': 'hoodedProfile',
      'trainer-research': 'hoodedProfile',
      data: 'hoodedProfile',
      compatibility: 'hoodedProfile',
      recipes: 'hoodedProfile',
      'proposal-inspector': 'recoveryPhoenix',
      'session-monitor': 'advancedDragon',
      'live-memory': 'advancedDragon',
      'registry-explorer': 'hoodedProfile',
      'catalog-save-controls': 'saveTools',
    });
  });

  test('section artwork matches the current sidebar sections', () => {
    assert.deepEqual(SECTION_ARTWORK, {
      Library: 'libraryTempleBook',
      Recovery: 'recoveryPhoenix',
      'Save Tools': 'saveTools',
      Specialized: 'hoodedProfile',
      Advanced: 'advancedDragon',
    });
  });

  test('library page headers and cards use section-specific artwork instead of the trainer controller', () => {
    const gameLibrary = readSource('src/app/routes/GameLibrary.tsx');
    const trainerLibrary = readSource('src/app/pages/TrainerLibraryPage.tsx');

    assert.match(gameLibrary, /artwork="gameLibraryControllerMonitors"/);
    assert.match(gameLibrary, /className="game-card-art"/);
    assert.match(trainerLibrary, /artwork="trainerLibraryStopwatchClipboard"/);
    assert.doesNotMatch(gameLibrary, /artwork="trainerController"/);
    assert.doesNotMatch(trainerLibrary, /artwork="trainerController"/);
  });
});

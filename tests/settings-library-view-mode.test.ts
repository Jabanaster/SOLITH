import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSettings,
  getLibraryViewMode,
  setLibraryViewMode,
  setSetting,
} from '../src/core/settings/index.ts';
import { initDatabase } from '../src/core/database/index.ts';

describe('libraryViewMode setting persistence', () => {
  before(async () => {
    await initDatabase();
  });

  test('missing libraryViewMode defaults to grid', () => {
    assert.equal(getLibraryViewMode(), 'grid');
  });

  test('getSettings() includes libraryViewMode default for a fresh database', () => {
    const settings = getSettings();
    assert.equal(settings.libraryViewMode, 'grid');
  });

  test('setLibraryViewMode persists and round-trips to list', () => {
    setLibraryViewMode('list');
    assert.equal(getLibraryViewMode(), 'list');
    assert.equal(getSettings().libraryViewMode, 'list');
    setLibraryViewMode('grid');
    assert.equal(getLibraryViewMode(), 'grid');
  });

  test('malformed/unknown libraryViewMode value fails safe to grid', () => {
    setSetting('libraryViewMode', 'not-a-real-mode');
    assert.equal(getLibraryViewMode(), 'grid');
    assert.equal(getSettings().libraryViewMode, 'grid');
    setSetting('libraryViewMode', 'grid');
  });

  test('legacy settings unaffected by libraryViewMode addition', () => {
    const settings = getSettings();
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.navCompactMode, false);
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { resetForTesting } from '../src/core/database/index.ts';
import { isFavorite, addFavorite, removeFavorite, toggleFavorite, listFavoriteIds } from '../src/core/favorites/store.ts';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_ROOT = path.join(os.tmpdir(), `solith-favorites-${RUN_ID}`);
const TEMP_DB = path.join(TEMP_ROOT, 'test.db');

describe('Favorites store', () => {
  before(async () => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    await resetForTesting(TEMP_DB);
  });

  after(() => {
    try {
      if (fs.existsSync(TEMP_ROOT)) fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('not favorite by default', () => {
    assert.equal(isFavorite('some-game'), false);
  });

  test('addFavorite marks it favorite, works for any game regardless of installed/owned/supported status', () => {
    addFavorite('installed-game');
    addFavorite('owned-unsupported-game');
    addFavorite('unowned-supported-game');
    addFavorite('missing-unsupported-game');
    assert.equal(isFavorite('installed-game'), true);
    assert.equal(isFavorite('owned-unsupported-game'), true);
    assert.equal(isFavorite('unowned-supported-game'), true);
    assert.equal(isFavorite('missing-unsupported-game'), true);
  });

  test('removeFavorite unmarks it', () => {
    addFavorite('temp-game');
    removeFavorite('temp-game');
    assert.equal(isFavorite('temp-game'), false);
  });

  test('toggleFavorite flips state and returns the new state', () => {
    assert.equal(isFavorite('toggle-game'), false);
    assert.equal(toggleFavorite('toggle-game'), true);
    assert.equal(isFavorite('toggle-game'), true);
    assert.equal(toggleFavorite('toggle-game'), false);
    assert.equal(isFavorite('toggle-game'), false);
  });

  test('adding an already-favorited game twice does not error or duplicate', () => {
    addFavorite('dup-game');
    addFavorite('dup-game');
    const ids = listFavoriteIds();
    assert.equal(ids.filter((id) => id === 'dup-game').length, 1);
  });

  test('listFavoriteIds returns all favorited canonical game ids', () => {
    const ids = listFavoriteIds();
    assert.ok(ids.includes('installed-game'));
    assert.ok(ids.includes('owned-unsupported-game'));
  });
});

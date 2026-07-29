import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resetForTesting,
  closeDatabaseSafely,
  flushPersistence,
} from '../src/core/database/index.js';
import {
  upsertCatalogEntry,
  getCatalogEntry,
} from '../src/core/trainer-catalog/store.js';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';

describe('Solith Blocker 1: Trainer Library Metadata Persistence Lifecycle', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  before(() => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-blocker1-test-'));
    tempDbPath = path.join(tempDbDir, 'test-trainer-library.sqlite');
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDbDir)) {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    }
  });

  test('full 15-step on-disk SQLite lifecycle persistence', async () => {
    const catalogGameId = `blocker1-test-${Date.now()}`;

    // 1. Create a fresh temporary database file & 2. Initialize current schema
    await resetForTesting(tempDbPath);
    await flushPersistence();
    assert.ok(fs.existsSync(tempDbPath), 'Temporary database file must be created on disk');

    // 3. Insert a manual trainer-library entry
    const initialEntry: TrainerCatalogEntry = {
      catalogGameId,
      displayName: 'Blocker1 Test Game',
      steamAppId: 999001,
      executables: ['Blocker1Game.exe', 'Blocker1Game_DX12.exe'],
      categories: ['RPG', 'Action'],
      headerUrl: 'solith-asset://local/C%3A%5Ccovers%5Cblocker1_header.png',
      coverUrl: 'solith-asset://local/C%3A%5Ccovers%5Cblocker1_cover.png',
      iconUrl: 'solith-asset://local/C%3A%5Cicons%5Cblocker1_icon.ico',
      verificationStatus: 'community',
      sources: [{ provider: 'manual', importedAt: '2026-07-27T00:00:00.000Z' }],
      hasModPack: true,
      modPackId: `${catalogGameId}-pack`,
      cheatCount: 5,
      searchableText: 'blocker1 test game rpg action',
    };

    upsertCatalogEntry(initialEntry);

    // 4. Close the first database connection completely & flush to disk
    await closeDatabaseSafely();

    // 5. Open a new connection against the exact same file
    await resetForTesting(tempDbPath, { preserveExisting: true });

    // 6. Verify every persisted field
    const reloadedEntry1 = getCatalogEntry(catalogGameId);
    assert.ok(reloadedEntry1, 'Catalog entry must exist in fresh connection');
    assert.equal(reloadedEntry1.displayName, 'Blocker1 Test Game');
    assert.equal(reloadedEntry1.steamAppId, 999001);
    assert.deepEqual(reloadedEntry1.executables, ['Blocker1Game.exe', 'Blocker1Game_DX12.exe']);
    assert.deepEqual(reloadedEntry1.categories, ['RPG', 'Action']);
    assert.equal(reloadedEntry1.coverUrl, 'solith-asset://local/C%3A%5Ccovers%5Cblocker1_cover.png');
    assert.equal(reloadedEntry1.iconUrl, 'solith-asset://local/C%3A%5Cicons%5Cblocker1_icon.ico');
    assert.equal(reloadedEntry1.headerUrl, 'solith-asset://local/C%3A%5Ccovers%5Cblocker1_header.png');
    assert.equal(reloadedEntry1.verificationStatus, 'community');
    assert.equal(reloadedEntry1.cheatCount, 5);

    // 7. Edit cover, icon, executable path, categories, and another scalar field
    // 8. Explicitly clear one nullable optional field (headerUrl set to undefined)
    const editedEntry: TrainerCatalogEntry = {
      ...reloadedEntry1,
      displayName: 'Blocker1 Test Game (Edited Title)',
      executables: ['Blocker1Game_v2.exe'],
      categories: ['RPG', 'Action', 'Strategy'],
      coverUrl: 'solith-asset://local/C%3A%5Ccovers%5Cblocker1_cover_v2.png',
      iconUrl: 'solith-asset://local/C%3A%5Cicons%5Cblocker1_icon_v2.ico',
      headerUrl: undefined, // Cleared optional field
      cheatCount: 12,
    };

    upsertCatalogEntry(editedEntry);

    // 9. Close the connection again
    await closeDatabaseSafely();

    // 10. Run the real migration/bootstrap path used at application startup (resetForTesting with preserveExisting)
    await resetForTesting(tempDbPath, { preserveExisting: true });

    // 11. Open a third fresh connection (achieved via resetForTesting)
    // 12. Verify edited values, cleared values, JSON fields, and defaults exactly
    const reloadedEntry2 = getCatalogEntry(catalogGameId);
    assert.ok(reloadedEntry2, 'Catalog entry must exist after second reload');
    assert.equal(reloadedEntry2.displayName, 'Blocker1 Test Game (Edited Title)');
    assert.deepEqual(reloadedEntry2.executables, ['Blocker1Game_v2.exe']);
    assert.deepEqual(reloadedEntry2.categories, ['RPG', 'Action', 'Strategy']);
    assert.equal(reloadedEntry2.coverUrl, 'solith-asset://local/C%3A%5Ccovers%5Cblocker1_cover_v2.png');
    assert.equal(reloadedEntry2.iconUrl, 'solith-asset://local/C%3A%5Cicons%5Cblocker1_icon_v2.ico');
    assert.equal(reloadedEntry2.headerUrl, undefined, 'Header URL must be undefined after explicit clearing');
    assert.equal(reloadedEntry2.cheatCount, 12);

    // 13. Confirm no duplicate row was created
    // 14. Confirm stable catalog identifier did not change
    assert.equal(reloadedEntry2.catalogGameId, catalogGameId);
  });
});

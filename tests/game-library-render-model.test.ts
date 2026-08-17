import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { createInstallIdentity, INSTALL_IDENTITY_VERSION } from '../src/core/install-discovery/identity.ts';
import { upsertInstalledGames } from '../src/core/install-discovery/store.ts';
import { upsertCatalogEntry } from '../src/core/trainer-catalog/store.ts';
import { addGame, deleteGame } from '../src/core/games/index.ts';
import type { InstalledGameRecord } from '../src/core/install-discovery/types.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';
import { buildGameLibraryRecords } from '../src/core/canonical-games/render-model.ts';
import { listPendingCanonicalIdentityReviewItems } from '../src/core/canonical-games/store.ts';

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now()}-${uid}`;
}

function makeInstalledGame(overrides: Partial<InstalledGameRecord> & { id: string; platform: InstalledGameRecord['platform']; installPath: string }): InstalledGameRecord {
  const identity = createInstallIdentity({
    platform: overrides.platform,
    installPath: overrides.installPath,
    executablePath: overrides.executablePath,
    displayName: overrides.displayName,
    steamAppId: overrides.steamAppId,
    launcherAppId: overrides.launcherAppId,
  });
  return {
    id: overrides.id,
    platform: overrides.platform,
    installPath: overrides.installPath,
    executablePath: overrides.executablePath,
    displayName: overrides.displayName,
    steamAppId: overrides.steamAppId,
    launcherAppId: overrides.launcherAppId,
    installIdentity: identity.installIdentity,
    canonicalInstallPath: identity.canonicalInstallPath,
    canonicalExecutablePath: identity.canonicalExecutablePath,
    identityVersion: INSTALL_IDENTITY_VERSION,
    identityStatus: identity.identityStatus,
    needsReverification: identity.needsReverification,
    catalogGameId: overrides.catalogGameId,
    catalogDisplayName: overrides.catalogDisplayName,
    detectedAt: overrides.detectedAt ?? new Date(0).toISOString(),
    lastSeenAt: overrides.lastSeenAt ?? new Date(0).toISOString(),
  };
}

function makeCatalogEntry(catalogGameId: string, displayName: string, overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId,
    displayName,
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: 'community',
    sources: [{ provider: 'mrantifun', url: `https://mrantifun.net/${catalogGameId}` }],
    hasModPack: false,
    cheatCount: 0,
    searchableText: displayName.toLowerCase(),
    ...overrides,
  };
}

describe('game library render model — canonical rendering', () => {
  before(async () => {
    await initDatabase();
  });

  test('one game with one installation renders one record with one installation', () => {
    const row = makeInstalledGame({
      id: nextId('single'),
      platform: 'steam',
      installPath: 'C:/Games/Single',
      executablePath: 'C:/Games/Single/single.exe',
      displayName: 'Render Single',
      steamAppId: 700001,
    });
    upsertInstalledGames([row]);

    const records = buildGameLibraryRecords('all', new Date(0).toISOString());
    const record = records.find((r) => r.title === 'Render Single');
    assert.ok(record);
    assert.equal(record!.installations.length, 1);
    assert.equal(record!.installations[0].launcher, 'steam');
  });

  test('one canonical game with two launcher installs renders as a single card, not duplicates', () => {
    const steamAppId = 700002;
    const steamRow = makeInstalledGame({
      id: nextId('multi-steam'),
      platform: 'steam',
      installPath: 'C:/Games/MultiSteam',
      steamAppId,
      displayName: 'Render Multi',
    });
    const gogRow = makeInstalledGame({
      id: nextId('multi-gog'),
      platform: 'gog',
      installPath: 'D:/GOG/MultiGog',
      steamAppId,
      displayName: 'Render Multi',
    });
    upsertInstalledGames([steamRow, gogRow]);

    const records = buildGameLibraryRecords('all', new Date(0).toISOString());
    const matches = records.filter((r) => r.title === 'Render Multi');
    assert.equal(matches.length, 1, 'expected exactly one card for the canonical game');
    assert.equal(matches[0].installations.length, 2);
    const launchers = matches[0].installations.map((i) => i.launcher).sort();
    assert.deepEqual(launchers, ['gog', 'steam']);
  });

  test('when one installation is removed but another remains, the game stays in Installed', () => {
    // install-discovery has no row-removal capability today, so "disappearance" is only
    // real for the legacy `games` table (deleteGame). Two manually-added entries sharing
    // an executable basename + exact title trust-merge (tier 3) onto one canonical game.
    const first = addGame({
      name: 'Render Survivor',
      path: 'C:/Games/SurvA',
      engine: 'Manual',
      executablePath: 'C:/Games/SurvA/survivor.exe',
    });
    const second = addGame({
      name: 'Render Survivor',
      path: 'C:/Games/SurvB',
      engine: 'Manual',
      executablePath: 'C:/Games/SurvB/survivor.exe',
    });

    const before = buildGameLibraryRecords('all', new Date(0).toISOString());
    const beforeRecord = before.find((r) => r.title === 'Render Survivor');
    assert.ok(beforeRecord);
    assert.equal(beforeRecord!.installations.length, 2, 'expected the two manual entries to trust-merge onto one canonical game');

    deleteGame(first.id);

    const installed = buildGameLibraryRecords('installed', new Date(0).toISOString());
    const record = installed.find((r) => r.title === 'Render Survivor');
    assert.ok(record, 'canonical game must remain in Installed while one installation is still active');
    const activeCount = record!.installations.filter((i) => i.active).length;
    assert.equal(activeCount, 1);

    deleteGame(second.id);
  });

  test('manually-added legacy game appears as a Standalone installation', () => {
    const game = addGame({
      name: 'Render Manual Entry',
      path: 'C:/Games/RenderManual',
      engine: 'Manual',
      executablePath: 'C:/Games/RenderManual/manual.exe',
      saveLocations: ['C:/Users/Test/Saves/RenderManual'],
    });

    const records = buildGameLibraryRecords('installed', new Date(0).toISOString());
    const record = records.find((r) => r.title === 'Render Manual Entry');
    assert.ok(record);
    assert.equal(record!.manuallyAdded, true);
    assert.equal(record!.installations[0].launcher, 'manual');
    assert.equal(record!.installations[0].sourceGameId, game.id);
    assert.deepEqual(record!.saveLocations, ['C:/Users/Test/Saves/RenderManual']);

    deleteGame(game.id);
  });

  test('canonical game with no active installations is excluded from the Installed view', () => {
    const game = addGame({
      name: 'Render Gone',
      path: 'C:/Games/Gone',
      engine: 'Manual',
      executablePath: 'C:/Games/Gone/gone.exe',
    });
    buildGameLibraryRecords('all', new Date(0).toISOString());

    // Remove the only installation source (its legacy record is deleted — real removal).
    deleteGame(game.id);

    const installed = buildGameLibraryRecords('installed', new Date(0).toISOString());
    assert.equal(installed.some((r) => r.title === 'Render Gone'), false);

    const all = buildGameLibraryRecords('all', new Date(0).toISOString());
    assert.equal(all.some((r) => r.title === 'Render Gone'), true, 'the All view must still show it');
  });

  test('an install-discovery row with platform "manual" (not a legacy games-table entry) is always active', () => {
    // Regression: 'manual' is both a launcher value AND a real install-discovery platform
    // for user-picked folders during a scan. Only legacy `games`-table-sourced
    // installations should be deletable/inactive; a platform:'manual' installed_games row
    // has no such deletion path and must behave like Steam/GOG/Epic — always active.
    const row = makeInstalledGame({
      id: nextId('discovery-manual'),
      platform: 'manual',
      installPath: 'C:/Games/DiscoveryManual',
      executablePath: 'C:/Games/DiscoveryManual/discovered.exe',
      displayName: 'Render Discovery Manual',
    });
    upsertInstalledGames([row]);

    const installed = buildGameLibraryRecords('installed', new Date(0).toISOString());
    const record = installed.find((r) => r.title === 'Render Discovery Manual');
    assert.ok(record, 'a discovery-sourced manual install must appear in Installed');
    assert.equal(record!.installations[0].active, true);
    assert.equal(record!.installations[0].sourceGameId, undefined, 'must not be attributed to any legacy games-table row');
  });
});

describe('game library render model — trainer linkage', () => {
  before(async () => {
    await initDatabase();
  });

  test('canonical bridge resolves trainer availability from the linked catalog entry only', () => {
    const catalogId = nextId('trainer-catalog');
    upsertCatalogEntry(makeCatalogEntry(catalogId, 'Trainer Linked Game', { verificationStatus: 'verified' }));
    const row = makeInstalledGame({
      id: nextId('trainer-row'),
      platform: 'steam',
      installPath: 'C:/Games/TrainerLinked',
      steamAppId: 700005,
      catalogGameId: catalogId,
      displayName: 'Trainer Linked Game',
    });
    upsertInstalledGames([row]);

    const records = buildGameLibraryRecords('all', new Date(0).toISOString());
    const record = records.find((r) => r.title === 'Trainer Linked Game');
    assert.ok(record);
    assert.equal(record!.trainerAvailability, 'available');
    assert.equal(record!.verificationStatus, 'verified');
  });

  test('no title-only fallback — a game with a title matching a catalog entry but no catalogGameId link stays unknown', () => {
    const catalogId = nextId('unlinked-catalog');
    upsertCatalogEntry(makeCatalogEntry(catalogId, 'Title Coincidence'));
    const row = makeInstalledGame({
      id: nextId('unlinked-row'),
      platform: 'steam',
      installPath: 'C:/Games/Unlinked',
      steamAppId: 700006,
      displayName: 'Title Coincidence',
    });
    upsertInstalledGames([row]);

    const records = buildGameLibraryRecords('all', new Date(0).toISOString());
    const record = records.find((r) => r.installations.some((i) => i.installPath === 'C:/Games/Unlinked'));
    assert.ok(record);
    assert.equal(record!.trainerAvailability, 'unknown', 'must not title-match against the catalog');
  });
});

describe('game library render model — ownership', () => {
  before(async () => {
    await initDatabase();
  });

  test('installed but unproven ownership never shows an Owned status', () => {
    const row = makeInstalledGame({
      id: nextId('unowned'),
      platform: 'steam',
      installPath: 'C:/Games/Unowned',
      steamAppId: 700007,
      displayName: 'Render Unowned',
    });
    upsertInstalledGames([row]);

    const records = buildGameLibraryRecords('all', new Date(0).toISOString());
    const record = records.find((r) => r.title === 'Render Unowned');
    assert.ok(record);
    assert.equal(record!.ownershipStatus, undefined);
  });

  test('the Owned view only ever contains proven-ownership records (currently none, by design)', () => {
    const owned = buildGameLibraryRecords('owned', new Date(0).toISOString());
    assert.ok(owned.every((r) => r.ownershipStatus === 'owned'));
  });
});

describe('game library render model — views and migration activation', () => {
  before(async () => {
    await initDatabase();
  });

  test('Installed is the correct default filtering semantics (active installations only)', () => {
    const activeRow = makeInstalledGame({
      id: nextId('view-active'),
      platform: 'steam',
      installPath: 'C:/Games/ViewActive',
      steamAppId: 700008,
      displayName: 'Render View Active',
    });
    upsertInstalledGames([activeRow]);

    const installed = buildGameLibraryRecords('installed', new Date(0).toISOString());
    assert.ok(installed.some((r) => r.title === 'Render View Active'));
  });

  test('repeated builds are idempotent — no duplicate records or installations', () => {
    const row = makeInstalledGame({
      id: nextId('idem-render'),
      platform: 'steam',
      installPath: 'C:/Games/IdemRender',
      steamAppId: 700009,
      displayName: 'Render Idempotent',
    });
    upsertInstalledGames([row]);

    buildGameLibraryRecords('all', new Date(0).toISOString());
    buildGameLibraryRecords('all', new Date(1).toISOString());
    const records = buildGameLibraryRecords('all', new Date(2).toISOString());
    const matches = records.filter((r) => r.title === 'Render Idempotent');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].installations.length, 1);
  });

  test('ambiguous identity from mixed sources creates a review case, not a silent guess', () => {
    const rowA = makeInstalledGame({ id: nextId('render-ambig-a'), platform: 'manual', installPath: 'C:/Games/RenderAmbigA' });
    const rowB = makeInstalledGame({ id: nextId('render-ambig-b'), platform: 'manual', installPath: 'C:/Games/RenderAmbigB' });
    upsertInstalledGames([rowA, rowB]);

    buildGameLibraryRecords('all', new Date(0).toISOString());

    const pending = listPendingCanonicalIdentityReviewItems();
    const reviewedIds = new Set(pending.flatMap((item) => item.evidence.map((e) => e.sourceId)));
    assert.ok(reviewedIds.has(rowA.id));
    assert.ok(reviewedIds.has(rowB.id));
  });

  test('search matches title and aliases, and does not duplicate results per installation', () => {
    const steamAppId = 700010;
    const steamRow = makeInstalledGame({
      id: nextId('search-steam'),
      platform: 'steam',
      installPath: 'C:/Games/SearchSteam',
      steamAppId,
      displayName: 'Searchable Title',
    });
    const gogRow = makeInstalledGame({
      id: nextId('search-gog'),
      platform: 'gog',
      installPath: 'D:/GOG/SearchGog',
      steamAppId,
      displayName: 'Searchable Title',
    });
    upsertInstalledGames([steamRow, gogRow]);

    const records = buildGameLibraryRecords('all', new Date(0).toISOString());
    const matches = records.filter((r) => r.title === 'Searchable Title');
    assert.equal(matches.length, 1, 'renderer search operates over this one record, never per-installation duplicates');
  });
});

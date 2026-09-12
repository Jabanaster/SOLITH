/**
 * Personal Library Final Certification pass — synthetic-only fixture seed
 * for the real-Electron-renderer fixture test
 * (tests/electron-personal-library.e2e.test.ts).
 *
 * Writes directly to the SQLite-backed store that the SAME userData
 * directory Electron will later be launched against uses — via the real
 * store modules (upsertCatalogEntry, upsertInstalledGames, addFavorite,
 * requestSupport), never raw SQL of its own. This runs OUTSIDE Electron
 * (plain tsx/node), so `getAppPaths()` falls back to
 * `SOLITH_TEST_USER_DATA_PATH` — the test sets both that and
 * `ELECTRON_USER_DATA_PATH` to the SAME directory before calling this, so
 * the seed and the later Electron launch see identical state.
 *
 * NO real game, NO real launcher account, NO real process — every id/path
 * here is synthetic and namespaced with an `fx-` / `fixture-` prefix.
 */
import crypto from 'node:crypto';

export const FIXTURE_IDS = {
  installedSupported: 'fx-installed-supported',
  installedUnsupported: 'fx-installed-unsupported',
  ownedSupported: 'fx-owned-supported',
  ownedUnsupported: 'fx-owned-unsupported',
  unownedSupported: 'fx-unowned-supported',
  favoriteGame: 'fx-favorite-game',
  supportRequestedGame: 'fx-support-requested-game',
  multiLauncherGame: 'fx-multi-launcher-game',
} as const;

export const UNMATCHED_LOCAL_INSTALL_DISPLAY_NAME = 'Fixture Unrecognized Local Install';

function baseCatalogEntry(id: string, displayName: string, hasModPack: boolean, ownedConfirmed: boolean) {
  return {
    catalogGameId: id,
    displayName,
    executables: [`${id}.exe`],
    categories: ['Action'],
    verificationStatus: 'verified' as const,
    sources: [{ provider: 'user' as const, url: 'fixture://seed' }],
    hasModPack,
    modPackId: undefined,
    cheatCount: hasModPack ? 5 : 0,
    searchableText: displayName.toLowerCase(),
    ownedConfirmed,
  };
}

function installRecord(overrides: {
  catalogGameId?: string;
  platform: 'steam' | 'epic' | 'gog' | 'xbox' | 'ubisoft' | 'ea' | 'battlenet' | 'manual';
  installIdentity: string;
  displayName?: string;
}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    installIdentity: overrides.installIdentity,
    canonicalInstallPath: `C:\\FixtureGames\\${overrides.installIdentity}`,
    canonicalExecutablePath: `C:\\FixtureGames\\${overrides.installIdentity}\\game.exe`,
    identityVersion: 1,
    identityStatus: 'verified' as const,
    needsReverification: false,
    catalogGameId: overrides.catalogGameId,
    platform: overrides.platform,
    installPath: `C:\\FixtureGames\\${overrides.installIdentity}`,
    executablePath: `C:\\FixtureGames\\${overrides.installIdentity}\\game.exe`,
    displayName: overrides.displayName,
    detectedAt: now,
    lastSeenAt: now,
  };
}

/**
 * Filler entries pushing total catalog count past ensureCatalogSeeded's
 * 1000-row threshold so the running Electron app never imports the real
 * production trainer-catalog-seed.json — this fixture test stays fully
 * synthetic. Named "Zzz Filler..." (not "Fixture Filler...") so they always
 * sort AFTER every meaningful "Fixture ..." fixture within the page's own
 * A-Z ordering — the 8 meaningful fixtures must land on the very first
 * PAGE_SIZE (120) page of the default (no-search, no-filter) fetch, since
 * that path does not eagerly fetch the entire catalog.
 */
function fillerEntries(count: number) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push(baseCatalogEntry(`fx-filler-${i}`, `Zzz Filler Game ${String(i).padStart(4, '0')}`, false, false));
  }
  return entries;
}

export async function seedPersonalLibraryFixtures(userDataPath: string): Promise<void> {
  process.env.SOLITH_TEST_USER_DATA_PATH = userDataPath;
  process.env.ELECTRON_USER_DATA_PATH = userDataPath;

  const { initDatabase, flushPersistence, closeDatabaseSafely } = await import('../../src/core/database/index.js');
  const { upsertCatalogEntry, setCatalogEntryOwnedConfirmed } = await import('../../src/core/trainer-catalog/store.js');
  const { upsertInstalledGames } = await import('../../src/core/install-discovery/store.js');
  const { addFavorite } = await import('../../src/core/favorites/store.js');
  const { requestSupport } = await import('../../src/core/support-requests/store.js');

  await initDatabase();

  // A/B — installed (supported + unsupported)
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.installedSupported, 'Fixture Installed Supported', true, false));
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.installedUnsupported, 'Fixture Installed Unsupported', false, false));
  // C/D — owned (supported + unsupported), never installed. ownedConfirmed
  // is deliberately NOT a column upsertCatalogEntry writes (it's the one
  // field a routine catalog sync must never clobber) — it can only be set
  // via setCatalogEntryOwnedConfirmed, the same real path
  // handleToggleOwned()/trainerCatalogSetOwned uses in the live app.
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.ownedSupported, 'Fixture Owned Supported', true, false));
  setCatalogEntryOwnedConfirmed(FIXTURE_IDS.ownedSupported, true);
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.ownedUnsupported, 'Fixture Owned Unsupported', false, false));
  setCatalogEntryOwnedConfirmed(FIXTURE_IDS.ownedUnsupported, true);
  // E — unowned, supported, not installed -> "All Other Games"
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.unownedSupported, 'Fixture Unowned Supported', true, false));
  // G — favorite fixture (also unowned/supported so it lands in "All Other Games")
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.favoriteGame, 'Fixture Favorite Game', true, false));
  // H — support-requested fixture (unsupported, owned so it's easy to find in "Owned — Support Needed")
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.supportRequestedGame, 'Fixture Support Requested Game', false, false));
  setCatalogEntryOwnedConfirmed(FIXTURE_IDS.supportRequestedGame, true);
  // I — multi-launcher canonical game (installed via two launchers)
  upsertCatalogEntry(baseCatalogEntry(FIXTURE_IDS.multiLauncherGame, 'Fixture Multi Launcher Game', true, false));

  // 1000 filler entries -> real catalog seed never triggers inside the fixture run
  for (const entry of fillerEntries(1000)) {
    upsertCatalogEntry(entry);
  }

  // Install-discovery records
  upsertInstalledGames([
    installRecord({ catalogGameId: FIXTURE_IDS.installedSupported, platform: 'steam', installIdentity: 'fx-install-a' }),
    installRecord({ catalogGameId: FIXTURE_IDS.installedUnsupported, platform: 'steam', installIdentity: 'fx-install-b' }),
    installRecord({ catalogGameId: FIXTURE_IDS.multiLauncherGame, platform: 'steam', installIdentity: 'fx-install-multi-steam' }),
    installRecord({ catalogGameId: FIXTURE_IDS.multiLauncherGame, platform: 'gog', installIdentity: 'fx-install-multi-gog' }),
    // F — unmatched local install (no catalogGameId at all) -> "Missing / Not Yet Supported"
    installRecord({
      platform: 'manual',
      installIdentity: 'fx-install-unmatched',
      displayName: UNMATCHED_LOCAL_INSTALL_DISPLAY_NAME,
    }),
  ]);

  // G — pre-favorited fixture
  addFavorite(FIXTURE_IDS.favoriteGame);

  // H — pre-existing support request (status REQUESTED)
  requestSupport({
    canonicalGameId: FIXTURE_IDS.supportRequestedGame,
    gameTitle: 'Fixture Support Requested Game',
    platforms: ['Steam'],
  });

  await flushPersistence();
  await closeDatabaseSafely();
}

/**
 * Mission 6 (certification pass) — "simulate support becoming available"
 * using only the existing, real architecture: flips the fixture's
 * `hasModPack` to true (the same field a real catalog sync/definition
 * publish would set) and calls the existing
 * `resolveSupportRequestIfExists` — no network call, no community
 * submission, purely local store mutation. Must run with Electron closed
 * (same on-disk-DB contract as the seed function itself).
 */
export async function simulateSupportBecomingAvailable(userDataPath: string, catalogGameId: string): Promise<void> {
  process.env.SOLITH_TEST_USER_DATA_PATH = userDataPath;
  process.env.ELECTRON_USER_DATA_PATH = userDataPath;

  const { initDatabase, flushPersistence, closeDatabaseSafely } = await import('../../src/core/database/index.js');
  const { getCatalogEntry, upsertCatalogEntry } = await import('../../src/core/trainer-catalog/store.js');
  const { resolveSupportRequestIfExists } = await import('../../src/core/support-requests/store.js');

  await initDatabase();

  const existing = getCatalogEntry(catalogGameId);
  if (!existing) throw new Error(`simulateSupportBecomingAvailable: no catalog entry for ${catalogGameId}`);
  upsertCatalogEntry({ ...existing, hasModPack: true, cheatCount: 5 });
  resolveSupportRequestIfExists(catalogGameId);

  await flushPersistence();
  await closeDatabaseSafely();
}

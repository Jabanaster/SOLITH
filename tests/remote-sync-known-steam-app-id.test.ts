import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { remoteTrainerToCatalogEntry, remoteTrainerToModPack } from '../src/core/trainer-catalog/sync/remote-sync.js';
import { knownSteamAppIdForCatalogGameId } from '../src/core/trainer-catalog/known-steam-app-ids.js';
import type { ParsedRemoteTrainer } from '../src/core/trainer-catalog/sync/parse-html.js';

// Real defect (Docs/phase3/004-p3-4-real-game-exit-gate-validation.md,
// Docs/phase3/006-*): the plitch-sourced "Crimson Desert Enhanced" catalog
// row was minted with a guessed executable name (`CrimsonDesertEnhanced.exe`)
// that does not exist on any real installed copy, and with no steamAppId at
// all — because remoteTrainerToCatalogEntry/remoteTrainerToModPack had no way
// to know the scraped title's real Steam identity. This is the regression
// coverage proving the ingestion-time fix: a hand-verified catalogGameId ->
// steamAppId association now backfills both the real executable name (via
// the existing curated STEAM_EXECUTABLE_LOOKUP) and the steamAppId/Steam CDN
// artwork fields (via the previously-orphaned applySteamAppId helper).

function trainer(gameName: string, sourceUrl = 'https://www.plitch.com/en/games/crimson-desert-enhanced'): ParsedRemoteTrainer {
  return { title: gameName, gameName, sourceUrl };
}

describe('remote-sync — known Steam AppID backfill (Crimson Desert Enhanced regression)', () => {
  test('resolves the real executable name for "Crimson Desert Enhanced", not a title-guessed one', () => {
    const entry = remoteTrainerToCatalogEntry(trainer('Crimson Desert Enhanced'), 'plitch');
    assert.deepEqual(entry.executables, ['CrimsonDesert.exe']);
    assert.notEqual(entry.executables[0], 'CrimsonDesertEnhanced.exe');
  });

  test('backfills steamAppId and Steam CDN artwork for "Crimson Desert Enhanced"', () => {
    const entry = remoteTrainerToCatalogEntry(trainer('Crimson Desert Enhanced'), 'plitch');
    assert.equal(entry.steamAppId, 3321460);
    assert.match(entry.headerUrl ?? '', /3321460/);
    assert.match(entry.coverUrl ?? '', /3321460/);
    assert.match(entry.iconUrl ?? '', /3321460/);
  });

  test('catalogGameId for "Crimson Desert Enhanced" is the expected canonical slug', () => {
    const entry = remoteTrainerToCatalogEntry(trainer('Crimson Desert Enhanced'), 'plitch');
    assert.equal(entry.catalogGameId, 'crimson-desert-enhanced');
  });

  test('mod pack version executables also resolve to the real binary name', () => {
    const pack = remoteTrainerToModPack(trainer('Crimson Desert Enhanced'), 'plitch');
    assert.deepEqual(pack.versions[0].executables, ['CrimsonDesert.exe']);
  });

  test('the older FLiNG "Crimson Desert" title is left without a steamAppId (orphan precondition)', () => {
    // Deliberately NOT in KNOWN_CATALOG_STEAM_APP_IDS: only the current
    // listing title is associated with the verified AppID. This is what lets
    // the crimson-desert-rename-orphan-v1 catalog reconciliation
    // (src/core/database/index.ts) safely retire this stale row later
    // (it requires the orphan's steamAppId to be NULL).
    const entry = remoteTrainerToCatalogEntry(trainer('Crimson Desert', 'https://flingtrainer.com/trainer/crimson-desert-trainer/'), 'fling');
    assert.equal(entry.steamAppId, undefined);
    // Its title-guessed executable happens to already be correct for this
    // one title, by coincidence of "Crimson Desert" compacting the same way
    // the real binary is named — this is not asserting the guess is reliable
    // in general, only pinning today's real value for this specific title.
    assert.deepEqual(entry.executables, ['CrimsonDesert.exe']);
  });

  test('an unrelated scraped title with no known AppID still uses the title-guess fallback, unaffected', () => {
    const entry = remoteTrainerToCatalogEntry(trainer('Some Unrelated Indie Game', 'https://www.plitch.com/en/games/some-unrelated-indie-game'), 'plitch');
    assert.equal(entry.steamAppId, undefined);
    assert.deepEqual(entry.executables, ['SomeUnrelatedIndieGame.exe']);
  });

  test('an unrelated title already covered by STEAM_EXECUTABLE_LOOKUP through a DIFFERENT catalogGameId is not affected by this association', () => {
    // Regression guard: knownSteamAppIdForCatalogGameId is keyed by
    // catalogGameId, never by executable name or steamAppId reverse-lookup —
    // adding the Crimson Desert association must not change resolution for
    // any other title.
    const entry = remoteTrainerToCatalogEntry(trainer('Palworld', 'https://www.plitch.com/en/games/palworld'), 'plitch');
    assert.equal(entry.steamAppId, undefined);
    assert.deepEqual(entry.executables, ['Palworld.exe']);
  });

  test('knownSteamAppIdForCatalogGameId returns undefined for ids with no explicit authorization', () => {
    assert.equal(knownSteamAppIdForCatalogGameId('crimson-desert'), undefined);
    assert.equal(knownSteamAppIdForCatalogGameId('some-random-unrelated-id'), undefined);
  });

  test('knownSteamAppIdForCatalogGameId returns the verified AppID for the authorized id', () => {
    assert.equal(knownSteamAppIdForCatalogGameId('crimson-desert-enhanced'), 3321460);
  });
});

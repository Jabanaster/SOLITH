import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../src/core/database/index.ts';
import {
  backfillMissingCatalogArtwork,
  getCatalogEntry,
  upsertCatalogEntry,
} from '../src/core/trainer-catalog/store.ts';
import { reconcileSeedArtwork } from '../src/core/trainer-catalog/seed.ts';
import { resolveCatalogCoverUrl } from '../src/core/trainer-catalog/cover-url.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

// Regression coverage for the P1 artwork root cause: popular installed titles
// (Palworld/Dredge/Stardew/...) were represented by remote-sync (plitch) rows
// that carry no Steam app id, so resolveCatalogCoverUrl() returned undefined
// and every card fell back to a synthetic monogram. reconcileSeedArtwork()
// backfills the curated seed's Steam artwork onto those rows without
// re-importing or downgrading any other field.

function plitchRow(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'palworld',
    displayName: 'Palworld',
    executables: ['Palworld-Win64-Shipping.exe'],
    categories: ['Survival', 'Action'],
    verificationStatus: 'verified',
    sources: [{ provider: 'plitch', url: 'https://www.plitch.com/en/games/palworld-1' }],
    hasModPack: true,
    cheatCount: 3,
    searchableText: 'palworld',
    ...overrides,
  };
}

describe('trainer catalog artwork reconcile', () => {
  beforeEach(async () => {
    await resetForTesting(':memory:');
  });

  test('a remote-sync row with no steamAppId resolves no cover before reconcile', () => {
    upsertCatalogEntry(plitchRow());
    const before = getCatalogEntry('palworld')!;
    assert.equal(before.steamAppId, undefined);
    assert.equal(resolveCatalogCoverUrl(before), undefined);
  });

  test('backfill fills a genuinely-empty row and the cover then resolves', () => {
    upsertCatalogEntry(plitchRow());
    const changed = backfillMissingCatalogArtwork('palworld', {
      steamAppId: 1623730,
      coverUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/library_600x900_2x.jpg',
    });
    assert.equal(changed, true);
    const after = getCatalogEntry('palworld')!;
    assert.equal(after.steamAppId, 1623730);
    assert.equal(
      resolveCatalogCoverUrl(after),
      'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/library_600x900_2x.jpg',
    );
  });

  test('backfill never overwrites a row that already has a steamAppId', () => {
    upsertCatalogEntry(plitchRow({ steamAppId: 111, coverUrl: undefined }));
    const changed = backfillMissingCatalogArtwork('palworld', { steamAppId: 1623730 });
    assert.equal(changed, false);
    assert.equal(getCatalogEntry('palworld')!.steamAppId, 111);
  });

  test('backfill preserves verification and cheat data', () => {
    upsertCatalogEntry(plitchRow({ verificationStatus: 'verified', cheatCount: 3 }));
    backfillMissingCatalogArtwork('palworld', { steamAppId: 1623730 });
    const after = getCatalogEntry('palworld')!;
    assert.equal(after.verificationStatus, 'verified');
    assert.equal(after.cheatCount, 3);
  });

  test('backfill is a no-op for a missing row', () => {
    assert.equal(backfillMissingCatalogArtwork('does-not-exist', { steamAppId: 1 }), false);
  });

  test('reconcileSeedArtwork fills matching empty rows and reports the count', () => {
    upsertCatalogEntry(plitchRow()); // palworld, no steamAppId
    upsertCatalogEntry(
      plitchRow({ catalogGameId: 'dredge', displayName: 'Dredge', searchableText: 'dredge' }),
    );
    const filled = reconcileSeedArtwork([
      { name: 'Palworld', steamAppId: 1623730 },
      { name: 'Dredge', steamAppId: 1562430 },
      { name: 'Not Installed Game', steamAppId: 999999 }, // no row → not counted
    ]);
    assert.equal(filled, 2);
    assert.equal(getCatalogEntry('palworld')!.steamAppId, 1623730);
    assert.equal(getCatalogEntry('dredge')!.steamAppId, 1562430);
    assert.ok(resolveCatalogCoverUrl(getCatalogEntry('dredge')!)?.includes('1562430'));
  });

  test('reconcileSeedArtwork is idempotent — a second pass fills nothing', () => {
    upsertCatalogEntry(plitchRow());
    assert.equal(reconcileSeedArtwork([{ name: 'Palworld', steamAppId: 1623730 }]), 1);
    assert.equal(reconcileSeedArtwork([{ name: 'Palworld', steamAppId: 1623730 }]), 0);
  });
});

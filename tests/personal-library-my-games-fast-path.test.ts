import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildMyGamesFastPath,
  type FastPathInstallRecord,
  type MyGamesFastPathInput,
} from '../src/app/hooks/personal-library-my-games.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

const NOW = '2026-09-10T00:00:00.000Z';

function baseInput(overrides: Partial<MyGamesFastPathInput> = {}): MyGamesFastPathInput {
  return {
    installRecords: [],
    ownedCatalogGameIds: [],
    favoriteCatalogGameIds: [],
    catalogEntriesById: {},
    runningCatalogGameId: null,
    nowIso: NOW,
    ...overrides,
  };
}

function installRecord(overrides: Partial<FastPathInstallRecord> & { catalogGameId?: string }): FastPathInstallRecord {
  return {
    catalogGameId: overrides.catalogGameId,
    catalogDisplayName: overrides.catalogDisplayName,
    identityStatus: overrides.identityStatus ?? 'verified',
    platform: overrides.platform ?? 'steam',
    installPath: overrides.installPath ?? 'C:/Games/example',
    executablePath: overrides.executablePath,
    detectedAt: overrides.detectedAt ?? NOW,
    lastSeenAt: overrides.lastSeenAt ?? NOW,
  };
}

function catalogEntry(overrides: Partial<TrainerCatalogEntry> & { catalogGameId: string }): TrainerCatalogEntry {
  return {
    catalogGameId: overrides.catalogGameId,
    displayName: overrides.displayName ?? overrides.catalogGameId,
    verificationStatus: overrides.verificationStatus ?? 'unverified',
    hasModPack: overrides.hasModPack ?? false,
    cheatCount: overrides.cheatCount ?? 0,
  } as TrainerCatalogEntry;
}

describe('buildMyGamesFastPath — honest gap: stays empty with no real evidence', () => {
  test('returns [] when there is no install, ownership, or favorite evidence at all', () => {
    const result = buildMyGamesFastPath(baseInput());
    assert.deepEqual(result, []);
  });
});

describe('buildMyGamesFastPath — composes real entries from install-discovery evidence', () => {
  test('an installed game with a catalogGameId produces one PersonalLibraryGame, installed=true', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [installRecord({ catalogGameId: 'game-1', catalogDisplayName: 'Game One' })],
      }),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].gameId, 'game-1');
    assert.equal(result[0].installed, true);
    assert.equal(result[0].title, 'Game One');
  });

  test('an install record with no catalogGameId is excluded (no stable identity to key on)', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [installRecord({ catalogGameId: undefined })],
      }),
    );
    assert.deepEqual(result, []);
  });

  test('multiple install records for the same catalogGameId across launchers collapse into one entry with both launchers', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [
          installRecord({ catalogGameId: 'game-1', platform: 'steam' }),
          installRecord({ catalogGameId: 'game-1', platform: 'epic' }),
        ],
      }),
    );
    assert.equal(result.length, 1);
    assert.deepEqual(new Set(result[0].launchers), new Set(['steam', 'epic']));
    assert.equal(result[0].installEvidence.length, 2);
  });
});

describe('buildMyGamesFastPath — ownership honesty', () => {
  test('owned-confirmed id produces owned: true with CONFIRMED evidence, even with no install record', () => {
    const result = buildMyGamesFastPath(baseInput({ ownedCatalogGameIds: ['game-owned'] }));
    assert.equal(result.length, 1);
    assert.equal(result[0].owned, true);
    assert.deepEqual(result[0].ownershipEvidence, [{ source: 'user-confirmed', confidence: 'CONFIRMED', owned: true }]);
    assert.equal(result[0].installed, false);
  });

  test('a game with no ownership signal resolves to owned: "unknown", never fabricated false', () => {
    const result = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'game-1' })] }),
    );
    assert.equal(result[0].owned, 'unknown');
    assert.deepEqual(result[0].ownershipEvidence, []);
  });
});

describe('buildMyGamesFastPath — favorites', () => {
  test('a favorited id with no install/ownership evidence still appears, favorite: true', () => {
    const result = buildMyGamesFastPath(baseInput({ favoriteCatalogGameIds: ['game-fav'] }));
    assert.equal(result.length, 1);
    assert.equal(result[0].favorite, true);
    assert.equal(result[0].installed, false);
    assert.equal(result[0].owned, 'unknown');
  });
});

describe('buildMyGamesFastPath — canonicalConfidence from real install-discovery identityStatus', () => {
  test('verified identityStatus maps to EXACT', () => {
    const result = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g', identityStatus: 'verified' })] }),
    );
    assert.equal(result[0].canonicalConfidence, 'EXACT');
  });

  test('backfilled maps to HIGH, ambiguous maps to POSSIBLE, legacy maps to UNKNOWN', () => {
    const backfilled = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g', identityStatus: 'backfilled' })] }),
    );
    const ambiguous = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g', identityStatus: 'ambiguous' })] }),
    );
    const legacy = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g', identityStatus: 'legacy' })] }),
    );
    assert.equal(backfilled[0].canonicalConfidence, 'HIGH');
    assert.equal(ambiguous[0].canonicalConfidence, 'POSSIBLE');
    assert.equal(legacy[0].canonicalConfidence, 'UNKNOWN');
  });

  test('a game with no install evidence at all (owned/favorite only) is UNKNOWN, never fabricated', () => {
    const result = buildMyGamesFastPath(baseInput({ ownedCatalogGameIds: ['game-owned'] }));
    assert.equal(result[0].canonicalConfidence, 'UNKNOWN');
  });

  test('the most confident identityStatus across multiple installs wins, never a weaker fabricated floor', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [
          installRecord({ catalogGameId: 'g', identityStatus: 'ambiguous', platform: 'steam' }),
          installRecord({ catalogGameId: 'g', identityStatus: 'verified', platform: 'epic' }),
        ],
      }),
    );
    assert.equal(result[0].canonicalConfidence, 'EXACT');
  });
});

describe('buildMyGamesFastPath — trainer fields, reduced-fidelity accuracy floor', () => {
  test('no resolved catalog entry -> trainerAvailability NONE, trainerAccuracy NONE', () => {
    const result = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g' })] }),
    );
    assert.equal(result[0].trainerAvailability, 'NONE');
    assert.equal(result[0].trainerAccuracy, 'NONE');
  });

  test('verified catalog entry -> trainerAvailability VERIFIED, but trainerAccuracy floors at VERSION_UNKNOWN (no receipt evidence gathered)', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [installRecord({ catalogGameId: 'g' })],
        catalogEntriesById: { g: catalogEntry({ catalogGameId: 'g', verificationStatus: 'verified', cheatCount: 12 }) },
      }),
    );
    assert.equal(result[0].trainerAvailability, 'VERIFIED');
    assert.equal(result[0].trainerAccuracy, 'VERSION_UNKNOWN');
    assert.equal(result[0].trainerCount, 12);
    assert.notEqual(result[0].trainerAccuracy, 'LOCALLY_VERIFIED');
    assert.notEqual(result[0].trainerAccuracy, 'EXACT_VERSION_MATCH');
  });

  test('a hasModPack-only entry -> trainerAvailability COMMUNITY', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [installRecord({ catalogGameId: 'g' })],
        catalogEntriesById: { g: catalogEntry({ catalogGameId: 'g', verificationStatus: 'unverified', hasModPack: true }) },
      }),
    );
    assert.equal(result[0].trainerAvailability, 'COMMUNITY');
  });

  test('versionEvidence is always empty (no version evidence gathered in this fast path)', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [installRecord({ catalogGameId: 'g' })],
        catalogEntriesById: { g: catalogEntry({ catalogGameId: 'g', verificationStatus: 'verified' }) },
      }),
    );
    assert.deepEqual(result[0].versionEvidence, []);
  });
});

describe('buildMyGamesFastPath — running cross-reference is real, not fabricated', () => {
  test('running flag is true only for the exact runningCatalogGameId supplied by the caller', () => {
    const result = buildMyGamesFastPath(
      baseInput({
        installRecords: [installRecord({ catalogGameId: 'g1' }), installRecord({ catalogGameId: 'g2' })],
        runningCatalogGameId: 'g2',
      }),
    );
    const g1 = result.find((g) => g.gameId === 'g1')!;
    const g2 = result.find((g) => g.gameId === 'g2')!;
    assert.equal(g1.running, false);
    assert.equal(g2.running, true);
  });

  test('no runningCatalogGameId supplied -> every entry stays running: false', () => {
    const result = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g1' })], runningCatalogGameId: undefined }),
    );
    assert.equal(result[0].running, false);
  });
});

describe('buildMyGamesFastPath — recentlyDetected computed from real detectedAt', () => {
  test('an installation detected just now is recentlyDetected', () => {
    const result = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g', detectedAt: NOW })], nowIso: NOW }),
    );
    assert.equal(result[0].recentlyDetected, true);
  });

  test('an installation detected 30 days ago is not recentlyDetected', () => {
    const thirtyDaysAgo = new Date(Date.parse(NOW) - 1000 * 60 * 60 * 24 * 30).toISOString();
    const result = buildMyGamesFastPath(
      baseInput({ installRecords: [installRecord({ catalogGameId: 'g', detectedAt: thirtyDaysAgo })], nowIso: NOW }),
    );
    assert.equal(result[0].recentlyDetected, false);
  });
});

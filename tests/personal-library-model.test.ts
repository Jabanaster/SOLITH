import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectPersonalLibraryGame,
  type PersonalLibraryProjectionInput,
} from '../src/core/personal-library/model.ts';
import type { GameInstallation } from '../src/core/canonical-games/types.ts';
import type { TrainerAccuracyEvidence } from '../src/core/trainer-catalog/trainer-accuracy.ts';

function installation(overrides: Partial<GameInstallation> = {}): GameInstallation {
  return {
    id: 'install-1',
    canonicalGameId: 'game-1',
    launcher: 'steam',
    installPath: 'C:/Games/Foo',
    executablePath: 'C:/Games/Foo/Foo.exe',
    installIdentity: 'exe:c:/games/foo/foo.exe',
    detectedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const NO_ACCURACY_EVIDENCE: TrainerAccuracyEvidence = {
  hasTrainer: false,
  hasValidationReceipt: false,
  receiptStillValid: false,
  receiptFailed: false,
  exactVersionEvidence: false,
  exactVersionMismatch: false,
  strongMatchEvidence: false,
};

function baseInput(overrides: Partial<PersonalLibraryProjectionInput> = {}): PersonalLibraryProjectionInput {
  return {
    gameId: 'game-1',
    title: 'Foo',
    running: false,
    installations: [],
    ownedConfirmed: undefined,
    favorite: false,
    canonicalIdentityStatus: undefined,
    catalogEntry: null,
    hasUserAuthoredDefinition: false,
    latestValidationReceipt: null,
    trainerAccuracyEvidence: NO_ACCURACY_EVIDENCE,
    nowIso: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('projectPersonalLibraryGame — ownership is never fabricated', () => {
  test('no ownedConfirmed evidence -> owned is the string "unknown", never false', () => {
    const result = projectPersonalLibraryGame(baseInput());
    assert.equal(result.owned, 'unknown');
    assert.notEqual(result.owned, false);
    assert.deepEqual(result.ownershipEvidence, []);
  });

  test('ownedConfirmed true -> owned true with CONFIRMED evidence', () => {
    const result = projectPersonalLibraryGame(baseInput({ ownedConfirmed: true }));
    assert.equal(result.owned, true);
    assert.equal(result.ownershipEvidence.length, 1);
    assert.equal(result.ownershipEvidence[0].confidence, 'CONFIRMED');
  });

  test('ownedConfirmed explicitly false -> owned false (real evidence, distinct from unknown)', () => {
    const result = projectPersonalLibraryGame(baseInput({ ownedConfirmed: false }));
    assert.equal(result.owned, false);
    assert.equal(result.ownershipEvidence.length, 1);
  });
});

describe('projectPersonalLibraryGame — installed/launchers/running', () => {
  test('no installations -> installed false, launchers empty', () => {
    const result = projectPersonalLibraryGame(baseInput());
    assert.equal(result.installed, false);
    assert.deepEqual(result.launchers, []);
  });

  test('installations present -> installed true, launchers deduped', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        installations: [installation({ launcher: 'steam' }), installation({ id: 'install-2', launcher: 'steam' })],
      }),
    );
    assert.equal(result.installed, true);
    assert.deepEqual(result.launchers, ['steam']);
  });

  test('running flag passes through unchanged', () => {
    const result = projectPersonalLibraryGame(baseInput({ running: true }));
    assert.equal(result.running, true);
  });
});

describe('projectPersonalLibraryGame — recentlyDetected', () => {
  test('installation detected within the window -> recentlyDetected true', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        nowIso: '2026-09-10T00:00:00.000Z',
        installations: [installation({ detectedAt: '2026-09-09T00:00:00.000Z' })],
      }),
    );
    assert.equal(result.recentlyDetected, true);
  });

  test('installation detected outside the window -> recentlyDetected false', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        nowIso: '2026-09-10T00:00:00.000Z',
        installations: [installation({ detectedAt: '2026-01-01T00:00:00.000Z' })],
      }),
    );
    assert.equal(result.recentlyDetected, false);
  });
});

describe('projectPersonalLibraryGame — canonicalConfidence mapping', () => {
  test('verified -> EXACT', () => {
    assert.equal(
      projectPersonalLibraryGame(baseInput({ canonicalIdentityStatus: 'verified' })).canonicalConfidence,
      'EXACT',
    );
  });
  test('backfilled -> HIGH', () => {
    assert.equal(
      projectPersonalLibraryGame(baseInput({ canonicalIdentityStatus: 'backfilled' })).canonicalConfidence,
      'HIGH',
    );
  });
  test('ambiguous -> POSSIBLE', () => {
    assert.equal(
      projectPersonalLibraryGame(baseInput({ canonicalIdentityStatus: 'ambiguous' })).canonicalConfidence,
      'POSSIBLE',
    );
  });
  test('undefined -> UNKNOWN', () => {
    assert.equal(
      projectPersonalLibraryGame(baseInput({ canonicalIdentityStatus: undefined })).canonicalConfidence,
      'UNKNOWN',
    );
  });
});

describe('projectPersonalLibraryGame — trainerAvailability precedence', () => {
  test('no catalog entry, no user-authored definition -> NONE', () => {
    assert.equal(projectPersonalLibraryGame(baseInput()).trainerAvailability, 'NONE');
  });

  test('user-authored definition takes precedence over everything -> LOCAL', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        hasUserAuthoredDefinition: true,
        catalogEntry: {
          catalogGameId: 'game-1',
          displayName: 'Foo',
          executables: [],
          categories: [],
          verificationStatus: 'verified',
          sources: [],
          hasModPack: true,
          cheatCount: 3,
          searchableText: 'foo',
        } as any,
      }),
    );
    assert.equal(result.trainerAvailability, 'LOCAL');
  });

  test('verificationStatus verified -> VERIFIED', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        catalogEntry: {
          catalogGameId: 'game-1',
          displayName: 'Foo',
          executables: [],
          categories: [],
          verificationStatus: 'verified',
          sources: [],
          hasModPack: true,
          cheatCount: 3,
          searchableText: 'foo',
        } as any,
      }),
    );
    assert.equal(result.trainerAvailability, 'VERIFIED');
  });

  test('community verification / hasModPack -> COMMUNITY', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        catalogEntry: {
          catalogGameId: 'game-1',
          displayName: 'Foo',
          executables: [],
          categories: [],
          verificationStatus: 'community',
          sources: [],
          hasModPack: true,
          cheatCount: 1,
          searchableText: 'foo',
        } as any,
      }),
    );
    assert.equal(result.trainerAvailability, 'COMMUNITY');
  });

  test('trainerCount mirrors catalog cheatCount', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        catalogEntry: {
          catalogGameId: 'game-1',
          displayName: 'Foo',
          executables: [],
          categories: [],
          verificationStatus: 'verified',
          sources: [],
          hasModPack: true,
          cheatCount: 7,
          searchableText: 'foo',
        } as any,
      }),
    );
    assert.equal(result.trainerCount, 7);
  });
});

describe('projectPersonalLibraryGame — trainerAccuracy delegates to computeTrainerAccuracy', () => {
  test('hasTrainer false -> NONE', () => {
    const result = projectPersonalLibraryGame(baseInput({ trainerAccuracyEvidence: NO_ACCURACY_EVIDENCE }));
    assert.equal(result.trainerAccuracy, 'NONE');
  });

  test('locally verified evidence -> LOCALLY_VERIFIED', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        trainerAccuracyEvidence: {
          ...NO_ACCURACY_EVIDENCE,
          hasTrainer: true,
          hasValidationReceipt: true,
          receiptStillValid: true,
        },
      }),
    );
    assert.equal(result.trainerAccuracy, 'LOCALLY_VERIFIED');
  });
});

describe('projectPersonalLibraryGame — versionEvidence composition', () => {
  test('installation buildVersion contributes install-sourced version evidence', () => {
    const result = projectPersonalLibraryGame(
      baseInput({
        installations: [installation({ buildVersion: '1.2.3' })],
      }),
    );
    assert.equal(result.versionEvidence.length, 1);
    assert.equal(result.versionEvidence[0].source, 'install');
    assert.equal(result.versionEvidence[0].executableVersion, '1.2.3');
  });

  test('no version/hash evidence anywhere -> empty versionEvidence', () => {
    const result = projectPersonalLibraryGame(baseInput());
    assert.deepEqual(result.versionEvidence, []);
  });
});

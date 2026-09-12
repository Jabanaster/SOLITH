import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeTrainerAccuracy,
  needsReverify,
  type TrainerAccuracyEvidence,
  type ReverifyCheckInput,
} from '../src/core/trainer-catalog/trainer-accuracy.ts';

function baseEvidence(overrides: Partial<TrainerAccuracyEvidence> = {}): TrainerAccuracyEvidence {
  return {
    hasTrainer: true,
    hasValidationReceipt: false,
    receiptStillValid: false,
    receiptFailed: false,
    exactVersionEvidence: false,
    exactVersionMismatch: false,
    strongMatchEvidence: false,
    ...overrides,
  };
}

describe('computeTrainerAccuracy', () => {
  test('NONE when no trainer exists at all', () => {
    const result = computeTrainerAccuracy(baseEvidence({ hasTrainer: false, exactVersionEvidence: true }));
    assert.equal(result, 'NONE');
  });

  test('INCOMPATIBLE when a validation receipt failed for current evidence', () => {
    const result = computeTrainerAccuracy(baseEvidence({ receiptFailed: true }));
    assert.equal(result, 'INCOMPATIBLE');
  });

  test('INCOMPATIBLE when exact version evidence explicitly mismatches', () => {
    const result = computeTrainerAccuracy(baseEvidence({ exactVersionMismatch: true }));
    assert.equal(result, 'INCOMPATIBLE');
  });

  test('INCOMPATIBLE outranks a positive local receipt (mismatch evidence wins)', () => {
    const result = computeTrainerAccuracy(
      baseEvidence({ hasValidationReceipt: true, receiptStillValid: true, exactVersionMismatch: true }),
    );
    assert.equal(result, 'INCOMPATIBLE');
  });

  test('LOCALLY_VERIFIED when a PASS receipt exists and evidence has not changed', () => {
    const result = computeTrainerAccuracy(baseEvidence({ hasValidationReceipt: true, receiptStillValid: true }));
    assert.equal(result, 'LOCALLY_VERIFIED');
  });

  test('NEEDS_REVERIFY when a PASS receipt exists but evidence has since changed', () => {
    const result = computeTrainerAccuracy(baseEvidence({ hasValidationReceipt: true, receiptStillValid: false }));
    assert.equal(result, 'NEEDS_REVERIFY');
  });

  test('EXACT_VERSION_MATCH when real hash/version evidence agrees exactly', () => {
    const result = computeTrainerAccuracy(baseEvidence({ exactVersionEvidence: true }));
    assert.equal(result, 'EXACT_VERSION_MATCH');
  });

  test('STRONG_MATCH when executable/module/title evidence strongly agrees but exact version is unknown', () => {
    const result = computeTrainerAccuracy(baseEvidence({ strongMatchEvidence: true }));
    assert.equal(result, 'STRONG_MATCH');
  });

  test('VERSION_UNKNOWN when a trainer exists but there is not enough evidence', () => {
    const result = computeTrainerAccuracy(baseEvidence());
    assert.equal(result, 'VERSION_UNKNOWN');
  });

  test('never returns EXACT_VERSION_MATCH from weak/title-based evidence alone (exactVersionEvidence false, strongMatchEvidence true)', () => {
    const result = computeTrainerAccuracy(
      baseEvidence({ exactVersionEvidence: false, strongMatchEvidence: true }),
    );
    assert.notEqual(result, 'EXACT_VERSION_MATCH');
    assert.equal(result, 'STRONG_MATCH');
  });
});

function baseReceiptFields() {
  return {
    executableName: 'game.exe',
    executableVersion: '1.2.3',
    executableHash: 'abc123',
    trainerSource: 'bundled',
    trainerVersionHint: 'v5',
  };
}

function baseReverifyInput(currentOverrides: Partial<ReverifyCheckInput['current']> = {}): ReverifyCheckInput {
  return {
    receipt: baseReceiptFields(),
    current: { ...baseReceiptFields(), ...currentOverrides },
  };
}

describe('needsReverify', () => {
  test('restart-with-unchanged-evidence stays LOCALLY_VERIFIED (returns false)', () => {
    const input = baseReverifyInput();
    assert.equal(needsReverify(input), false);
  });

  test('triggers when executable name changed', () => {
    const input = baseReverifyInput({ executableName: 'other-game.exe' });
    assert.equal(needsReverify(input), true);
  });

  test('triggers when executable version changed (both sides present)', () => {
    const input = baseReverifyInput({ executableVersion: '1.2.4' });
    assert.equal(needsReverify(input), true);
  });

  test('triggers when executable hash changed (both sides present)', () => {
    const input = baseReverifyInput({ executableHash: 'def456' });
    assert.equal(needsReverify(input), true);
  });

  test('triggers when trainer source changed', () => {
    const input = baseReverifyInput({ trainerSource: 'community' });
    assert.equal(needsReverify(input), true);
  });

  test('triggers when trainer version hint changed (both sides present)', () => {
    const input = baseReverifyInput({ trainerVersionHint: 'v6' });
    assert.equal(needsReverify(input), true);
  });

  test('triggers when canonicalExecutableIdentityChanged is true', () => {
    const input = baseReverifyInput({ canonicalExecutableIdentityChanged: true });
    assert.equal(needsReverify(input), true);
  });

  test('triggers when launcherBuildChangedMaterially is true', () => {
    const input = baseReverifyInput({ launcherBuildChangedMaterially: true });
    assert.equal(needsReverify(input), true);
  });

  test('missing optional hash on current side does NOT spuriously trigger reverify', () => {
    const input: ReverifyCheckInput = {
      receipt: baseReceiptFields(),
      current: { ...baseReceiptFields(), executableHash: undefined },
    };
    assert.equal(needsReverify(input), false);
  });

  test('missing optional version on receipt side does NOT spuriously trigger reverify', () => {
    const input: ReverifyCheckInput = {
      receipt: { ...baseReceiptFields(), executableVersion: undefined },
      current: baseReceiptFields(),
    };
    assert.equal(needsReverify(input), false);
  });

  test('missing optional trainerVersionHint on both sides does NOT trigger reverify', () => {
    const input: ReverifyCheckInput = {
      receipt: { ...baseReceiptFields(), trainerVersionHint: undefined },
      current: { ...baseReceiptFields(), trainerVersionHint: undefined },
    };
    assert.equal(needsReverify(input), false);
  });
});

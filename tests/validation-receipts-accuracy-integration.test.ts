/**
 * Mission 6 — validation receipts -> accuracy badge integration gap.
 *
 * Proves, with REAL function calls (recordValidationReceipt/getLatestReceipt
 * from the actual validation-receipts store, deriveReceiptEvidence from the
 * new receipt-evidence bridge, and the EXISTING computeTrainerAccuracy from
 * trainer-catalog/trainer-accuracy.ts — never reimplemented here), that:
 *
 *  1. No receipt for a game never produces LOCALLY_VERIFIED, even when a
 *     mod-pack/trainer exists for that game (hasTrainer: true).
 *  2. A real receipt whose stored executable/version/hash fields match the
 *     current evidence snapshot CAN produce LOCALLY_VERIFIED.
 *  3. A real receipt whose stored executable version/hash MISMATCHES the
 *     current evidence snapshot degrades to NEEDS_REVERIFY via the existing
 *     needsReverify rule (invoked internally by deriveReceiptEvidence) —
 *     that rule itself is not reimplemented anywhere in this file.
 *
 * IMPORTANT — every receipt recorded below is a SYNTHETIC TEST FIXTURE
 * written directly to a throwaway temp database via the real
 * recordValidationReceipt() API. None of it is produced by, or could be
 * mistaken for, an actual local READ_CONFIRMED/WRITE_CONFIRMED validation of
 * a real trainer run against a real running game. This file never touches
 * production code paths (electron/main.ts, preload.ts, or
 * TrainerLibraryPage.tsx's rendering) — it exercises the pure model layer
 * only, exactly like the existing trainer-accuracy.test.ts and
 * validation-receipts-store.test.ts it sits alongside.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { resetForTesting } from '../src/core/database/index.ts';
import { recordValidationReceipt, getLatestReceipt } from '../src/core/validation-receipts/store.ts';
import { deriveReceiptEvidence } from '../src/core/validation-receipts/receipt-evidence.ts';
import { computeTrainerAccuracy, type TrainerAccuracyEvidence } from '../src/core/trainer-catalog/trainer-accuracy.ts';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_ROOT = path.join(os.tmpdir(), `solith-validation-receipts-accuracy-${RUN_ID}`);
const TEMP_DB = path.join(TEMP_ROOT, 'test.db');

function baseAccuracyEvidence(overrides: Partial<TrainerAccuracyEvidence> = {}): TrainerAccuracyEvidence {
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

describe('Validation receipts -> accuracy badge integration (Mission 6)', () => {
  before(async () => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    await resetForTesting(TEMP_DB);
  });

  after(() => {
    try {
      if (fs.existsSync(TEMP_ROOT)) fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    } catch {
      /* ignore — best-effort temp cleanup */
    }
  });

  test('Requirement 1: no receipt for a game never yields LOCALLY_VERIFIED, even with a mod-pack/trainer present', () => {
    // Real store call — no receipt has ever been recorded for this gameId.
    const latestReceipt = getLatestReceipt('req1-game-no-receipt', 'req1-game-no-receipt');
    assert.equal(latestReceipt, null);

    const receiptEvidence = deriveReceiptEvidence(latestReceipt, {
      executableName: 'game.exe',
      executableVersion: '1.0.0',
      executableHash: 'hash-current',
      trainerSource: 'bundled',
    });
    assert.deepEqual(receiptEvidence, {
      hasValidationReceipt: false,
      receiptStillValid: false,
      receiptFailed: false,
    });

    // hasTrainer: true (a mod-pack/trainer exists) must not matter here.
    const state = computeTrainerAccuracy(
      baseAccuracyEvidence({ hasTrainer: true, ...receiptEvidence, strongMatchEvidence: true }),
    );
    assert.notEqual(state, 'LOCALLY_VERIFIED');
    assert.equal(state, 'STRONG_MATCH');
  });

  test('Requirement 2: a real receipt matching current executable+version+hash evidence can produce LOCALLY_VERIFIED', () => {
    // SYNTHETIC TEST FIXTURE ONLY — written directly via the real
    // recordValidationReceipt() API to a throwaway temp DB for this test.
    // This is NOT evidence of any real validated trainer run.
    const recorded = recordValidationReceipt({
      gameId: 'req2-game-match',
      trainerId: 'req2-game-match',
      executableName: 'game.exe',
      executableVersion: '1.0.0',
      executableHash: 'hash-abc',
      trainerSource: 'bundled',
      trainerVersionHint: 'v1',
      validationType: 'READ_CONFIRMED',
      result: 'PASS',
    });
    assert.equal(recorded.result, 'PASS');

    const latestReceipt = getLatestReceipt('req2-game-match', 'req2-game-match');
    assert.ok(latestReceipt);

    // Current evidence snapshot matches the receipt exactly.
    const receiptEvidence = deriveReceiptEvidence(latestReceipt, {
      executableName: 'game.exe',
      executableVersion: '1.0.0',
      executableHash: 'hash-abc',
      trainerSource: 'bundled',
      trainerVersionHint: 'v1',
    });
    assert.deepEqual(receiptEvidence, {
      hasValidationReceipt: true,
      receiptStillValid: true,
      receiptFailed: false,
    });

    const state = computeTrainerAccuracy(baseAccuracyEvidence({ hasTrainer: true, ...receiptEvidence }));
    assert.equal(state, 'LOCALLY_VERIFIED');
  });

  test('Requirement 3: a receipt with mismatched executable version/hash degrades to NEEDS_REVERIFY', () => {
    // SYNTHETIC TEST FIXTURE ONLY — same caveat as above; not real evidence.
    recordValidationReceipt({
      gameId: 'req3-game-mismatch',
      trainerId: 'req3-game-mismatch',
      executableName: 'game.exe',
      executableVersion: '1.0.0',
      executableHash: 'hash-abc',
      trainerSource: 'bundled',
      validationType: 'READ_CONFIRMED',
      result: 'PASS',
    });

    const latestReceipt = getLatestReceipt('req3-game-mismatch', 'req3-game-mismatch');
    assert.ok(latestReceipt);
    assert.equal(latestReceipt?.result, 'PASS');

    // Current evidence disagrees on both version and hash (both sides
    // present, both differ — the EXISTING needsReverify rule, not
    // reimplemented here, is what actually flags this).
    const receiptEvidence = deriveReceiptEvidence(latestReceipt, {
      executableName: 'game.exe',
      executableVersion: '2.0.0',
      executableHash: 'hash-def',
      trainerSource: 'bundled',
    });
    assert.deepEqual(receiptEvidence, {
      hasValidationReceipt: true,
      receiptStillValid: false,
      receiptFailed: false,
    });

    const state = computeTrainerAccuracy(baseAccuracyEvidence({ hasTrainer: true, ...receiptEvidence }));
    assert.equal(state, 'NEEDS_REVERIFY');
  });

  test('a FAIL receipt yields receiptFailed evidence and INCOMPATIBLE, never LOCALLY_VERIFIED', () => {
    // SYNTHETIC TEST FIXTURE ONLY.
    recordValidationReceipt({
      gameId: 'req4-game-fail',
      trainerId: 'req4-game-fail',
      executableName: 'game.exe',
      trainerSource: 'bundled',
      validationType: 'READ_CONFIRMED',
      result: 'FAIL',
    });

    const latestReceipt = getLatestReceipt('req4-game-fail', 'req4-game-fail');
    const receiptEvidence = deriveReceiptEvidence(latestReceipt, {
      executableName: 'game.exe',
      trainerSource: 'bundled',
    });
    assert.deepEqual(receiptEvidence, {
      hasValidationReceipt: false,
      receiptStillValid: false,
      receiptFailed: true,
    });

    const state = computeTrainerAccuracy(baseAccuracyEvidence({ hasTrainer: true, ...receiptEvidence }));
    assert.equal(state, 'INCOMPATIBLE');
  });

  test('a STALE receipt is treated as no usable receipt (never fabricates LOCALLY_VERIFIED or INCOMPATIBLE)', () => {
    // SYNTHETIC TEST FIXTURE ONLY.
    recordValidationReceipt({
      gameId: 'req5-game-stale',
      trainerId: 'req5-game-stale',
      executableName: 'game.exe',
      trainerSource: 'bundled',
      validationType: 'READ_CONFIRMED',
      result: 'STALE',
    });

    const latestReceipt = getLatestReceipt('req5-game-stale', 'req5-game-stale');
    const receiptEvidence = deriveReceiptEvidence(latestReceipt, {
      executableName: 'game.exe',
      trainerSource: 'bundled',
    });
    assert.deepEqual(receiptEvidence, {
      hasValidationReceipt: false,
      receiptStillValid: false,
      receiptFailed: false,
    });

    const state = computeTrainerAccuracy(baseAccuracyEvidence({ hasTrainer: true, ...receiptEvidence }));
    assert.notEqual(state, 'LOCALLY_VERIFIED');
    assert.notEqual(state, 'INCOMPATIBLE');
  });
});

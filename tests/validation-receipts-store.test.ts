import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { resetForTesting } from '../src/core/database/index.ts';
import {
  recordValidationReceipt,
  getLatestReceipt,
  listReceiptsForTrainer,
  listReceiptsForGame,
} from '../src/core/validation-receipts/store.ts';

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TEMP_ROOT = path.join(os.tmpdir(), `solith-validation-receipts-${RUN_ID}`);
const TEMP_DB = path.join(TEMP_ROOT, 'test.db');

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'game-1',
    trainerId: 'trainer-1',
    executableName: 'game.exe',
    trainerSource: 'bundled',
    validationType: 'READ_CONFIRMED' as const,
    result: 'PASS' as const,
    ...overrides,
  };
}

describe('Validation receipts store', () => {
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

  test('recordValidationReceipt persists and returns the full receipt with a generated receiptId', () => {
    const receipt = recordValidationReceipt(baseInput());
    assert.ok(receipt.receiptId);
    assert.equal(receipt.gameId, 'game-1');
    assert.equal(receipt.trainerId, 'trainer-1');
    assert.equal(receipt.executableName, 'game.exe');
    assert.equal(receipt.trainerSource, 'bundled');
    assert.equal(receipt.validationType, 'READ_CONFIRMED');
    assert.equal(receipt.result, 'PASS');
    assert.ok(receipt.validatedAt);
    assert.equal(receipt.cheatId, undefined);
  });

  test('recordValidationReceipt stores optional fields when provided', () => {
    const receipt = recordValidationReceipt(
      baseInput({
        gameId: 'game-optional',
        cheatId: 'cheat-1',
        executableVersion: '1.0.0',
        executableHash: 'hash-abc',
        trainerVersionHint: 'v1',
      }),
    );
    assert.equal(receipt.cheatId, 'cheat-1');
    assert.equal(receipt.executableVersion, '1.0.0');
    assert.equal(receipt.executableHash, 'hash-abc');
    assert.equal(receipt.trainerVersionHint, 'v1');
  });

  test('getLatestReceipt returns null when no receipt exists for the pairing', () => {
    assert.equal(getLatestReceipt('no-such-game', 'no-such-trainer'), null);
  });

  test('getLatestReceipt returns the most recently recorded receipt for the exact game+trainer pairing', () => {
    recordValidationReceipt(baseInput({ gameId: 'game-latest', trainerId: 'trainer-latest', result: 'PASS' }));
    const second = recordValidationReceipt(
      baseInput({ gameId: 'game-latest', trainerId: 'trainer-latest', result: 'FAIL' }),
    );
    const latest = getLatestReceipt('game-latest', 'trainer-latest');
    assert.equal(latest?.receiptId, second.receiptId);
    assert.equal(latest?.result, 'FAIL');
  });

  test('receipts are scoped per game+trainer — a different trainer for the same game is not returned', () => {
    recordValidationReceipt(baseInput({ gameId: 'game-scope', trainerId: 'trainer-a' }));
    assert.equal(getLatestReceipt('game-scope', 'trainer-b'), null);
  });

  test('listReceiptsForTrainer returns every receipt for the exact game+trainer pairing, newest first', () => {
    recordValidationReceipt(baseInput({ gameId: 'game-list', trainerId: 'trainer-list', result: 'PASS' }));
    recordValidationReceipt(baseInput({ gameId: 'game-list', trainerId: 'trainer-list', result: 'STALE' }));
    const receipts = listReceiptsForTrainer('game-list', 'trainer-list');
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].result, 'STALE');
    assert.equal(receipts[1].result, 'PASS');
  });

  test('listReceiptsForGame returns receipts across all trainers for that game only', () => {
    recordValidationReceipt(baseInput({ gameId: 'game-multi', trainerId: 'trainer-x' }));
    recordValidationReceipt(baseInput({ gameId: 'game-multi', trainerId: 'trainer-y' }));
    recordValidationReceipt(baseInput({ gameId: 'game-other', trainerId: 'trainer-z' }));
    const receipts = listReceiptsForGame('game-multi');
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every((r) => r.gameId === 'game-multi'));
  });

  test('rejects missing required field gameId', () => {
    const input = baseInput() as Record<string, unknown>;
    delete input.gameId;
    assert.throws(() => recordValidationReceipt(input as never));
  });

  test('rejects missing required field trainerId', () => {
    const input = baseInput() as Record<string, unknown>;
    delete input.trainerId;
    assert.throws(() => recordValidationReceipt(input as never));
  });

  test('rejects missing required field executableName', () => {
    const input = baseInput() as Record<string, unknown>;
    delete input.executableName;
    assert.throws(() => recordValidationReceipt(input as never));
  });

  test('rejects missing required field trainerSource', () => {
    const input = baseInput() as Record<string, unknown>;
    delete input.trainerSource;
    assert.throws(() => recordValidationReceipt(input as never));
  });

  test('rejects an invalid validationType enum value', () => {
    assert.throws(() => recordValidationReceipt(baseInput({ validationType: 'BOGUS' }) as never));
  });

  test('rejects an invalid result enum value', () => {
    assert.throws(() => recordValidationReceipt(baseInput({ result: 'BOGUS' }) as never));
  });

  test('rejects unknown extra fields (strict schema)', () => {
    assert.throws(() => recordValidationReceipt(baseInput({ rawMemoryDump: 'not allowed' }) as never));
  });
});

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readJsonSaveField,
  validateJsonSaveFieldProposal,
  writeJsonSaveField,
} from '../src/core/saves/json-save-field.ts';

describe('json save-field writes', () => {
  let tmpDir = '';
  let filePath = '';

  test('setup fixture', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-json-write-'));
    filePath = path.join(tmpDir, 'save.json');
    fs.writeFileSync(filePath, JSON.stringify({ stats: { gold: 100, alive: true } }, null, 2), 'utf-8');
  });

  test('writes numeric and boolean scalars with backup', () => {
    const gold = writeJsonSaveField(filePath, 'stats.gold', '100', '250');
    assert.equal(gold.verifiedValue, '250');
    assert.ok(fs.existsSync(gold.backupPath));

    const alive = writeJsonSaveField(filePath, 'stats.alive', 'true', 'false');
    assert.equal(alive.verifiedValue, 'false');

    const readGold = readJsonSaveField(filePath, 'stats.gold');
    const readAlive = readJsonSaveField(filePath, 'stats.alive');
    assert.equal(readGold.value, 250);
    assert.equal(readAlive.value, false);
  });

  test('rejects type-changing proposals', () => {
    assert.throws(
      () => validateJsonSaveFieldProposal(filePath, 'stats.gold', '250', 'not-a-number'),
      /json_proposal_type_mismatch/,
    );
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

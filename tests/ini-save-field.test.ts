import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readIniSaveField,
  validateIniSaveFieldProposal,
  writeIniSaveField,
} from '../src/core/saves/ini-save-field.ts';

describe('ini save-field writes', () => {
  let tmpDir = '';
  let filePath = '';

  test('setup fixture', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ini-write-'));
    filePath = path.join(tmpDir, 'settings.ini');
    fs.writeFileSync(filePath, '[stats]\n; gold counter\ngold=100\n', 'utf-8');
  });

  test('writes section.key values while preserving comments', () => {
    const result = writeIniSaveField(filePath, 'stats.gold', '100', '250');
    assert.equal(result.verifiedValue, '250');
    assert.ok(fs.existsSync(result.backupPath));

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /; gold counter/);
    assert.match(content, /gold=250/);

    const readResult = readIniSaveField(filePath, 'stats.gold');
    assert.equal(readResult.found, true);
    assert.equal(readResult.value, '250');
  });

  test('rejects value mismatch during proposal validation', () => {
    assert.throws(
      () => validateIniSaveFieldProposal(filePath, 'stats.gold', '100', '999'),
      /value_mismatch/,
    );
  });

  after(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

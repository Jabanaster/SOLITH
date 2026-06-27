/**
 * Unit tests for write-save-field.ts (child-process write logic).
 *
 * All tests operate on a temp copy of the fixture so the fixture is never
 * mutated. Each test group that writes starts from a fresh copy.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { proposeWriteField, executeWriteField, rollbackWriteField } from '../../src/core/trainer-host/write-save-field.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../demo-game/save/stardew-fixture.xml');
const FIELD = 'SaveGame.player.0.money';
const KNOWN_VALUE = '5000';
const NEW_VALUE = '12345';

function makeTmp(suffix = ''): string {
  return path.join(os.tmpdir(), `trainer-write-test-${Date.now()}${suffix}.xml`);
}

// ── proposeWriteField ─────────────────────────────────────────────────────────

describe('proposeWriteField', () => {
  let tmp: string;

  before(() => {
    assert.ok(fs.existsSync(FIXTURE), `fixture missing: ${FIXTURE}`);
    tmp = makeTmp('-propose');
    fs.copyFileSync(FIXTURE, tmp);
  });

  after(() => {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  });

  test('returns valid:true when file + field + currentValue are correct', async () => {
    const result = await proposeWriteField({ filePath: tmp, field: FIELD, currentValue: KNOWN_VALUE, newValue: NEW_VALUE });
    assert.equal(result.valid, true);
  });

  test('throws file_not_found for non-existent path', async () => {
    await assert.rejects(
      () => proposeWriteField({ filePath: '/no/such/file.xml', field: FIELD, currentValue: KNOWN_VALUE, newValue: NEW_VALUE }),
      /file_not_found/,
    );
  });

  test('throws value_mismatch when currentValue is wrong', async () => {
    await assert.rejects(
      () => proposeWriteField({ filePath: tmp, field: FIELD, currentValue: '9999999', newValue: NEW_VALUE }),
      /value_mismatch/,
    );
  });

  test('throws field_not_found for non-existent field path', async () => {
    await assert.rejects(
      () => proposeWriteField({ filePath: tmp, field: 'SaveGame.player.0.nonexistent', currentValue: 'x', newValue: 'y' }),
      /field_not_found|value_mismatch/,
    );
  });

  test('throws invalid_params when params are missing required keys', async () => {
    await assert.rejects(
      () => proposeWriteField({ filePath: tmp }),
      /invalid_params/,
    );
  });

  test('throws xml_safety on DOCTYPE content', async () => {
    const evil = tmp + '.evil.xml';
    fs.writeFileSync(evil, '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root/>', 'utf-8');
    try {
      await assert.rejects(
        () => proposeWriteField({ filePath: evil, field: FIELD, currentValue: KNOWN_VALUE, newValue: NEW_VALUE }),
        /xml_safety/,
      );
    } finally {
      fs.unlinkSync(evil);
    }
  });
});

// ── executeWriteField ─────────────────────────────────────────────────────────

describe('executeWriteField', () => {
  let tmp: string;

  before(() => {
    tmp = makeTmp('-execute');
    fs.copyFileSync(FIXTURE, tmp);
  });

  after(() => {
    for (const p of [tmp, tmp + '.trainer-backup', tmp + '.trainer-tmp']) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  test('writes new value, returns written:true + verifiedValue + backupPath', async () => {
    const result = await executeWriteField({
      filePath: tmp,
      field: FIELD,
      currentValue: KNOWN_VALUE,
      newValue: NEW_VALUE,
    });
    assert.equal(result.written, true);
    assert.equal(result.verifiedValue, NEW_VALUE);
    assert.ok(result.backupPath.endsWith('.trainer-backup'));
    assert.ok(fs.existsSync(result.backupPath), 'backup file must exist');
  });

  test('backup contains the original value', async () => {
    const backupPath = tmp + '.trainer-backup';
    assert.ok(fs.existsSync(backupPath));
    const content = fs.readFileSync(backupPath, 'utf-8');
    assert.ok(content.includes(`<money>${KNOWN_VALUE}</money>`), 'backup should have original money value');
  });

  test('throws value_changed_since_proposal if currentValue no longer matches', async () => {
    // tmp now has NEW_VALUE written; trying to write again with KNOWN_VALUE as current should fail
    await assert.rejects(
      () => executeWriteField({ filePath: tmp, field: FIELD, currentValue: KNOWN_VALUE, newValue: '99999' }),
      /value_changed_since_proposal/,
    );
  });

  test('throws file_not_found for missing file', async () => {
    await assert.rejects(
      () => executeWriteField({ filePath: '/no/such/file.xml', field: FIELD, currentValue: KNOWN_VALUE, newValue: NEW_VALUE }),
      /file_not_found/,
    );
  });

  test('throws invalid_params for missing newValue', async () => {
    await assert.rejects(
      () => executeWriteField({ filePath: tmp, field: FIELD, currentValue: NEW_VALUE }),
      /invalid_params/,
    );
  });
});

// ── rollbackWriteField ────────────────────────────────────────────────────────

describe('rollbackWriteField', () => {
  let tmp: string;
  let backupPath: string;

  before(async () => {
    tmp = makeTmp('-rollback');
    fs.copyFileSync(FIXTURE, tmp);
    // Write first so we have a backup to roll back from
    const writeResult = await executeWriteField({
      filePath: tmp,
      field: FIELD,
      currentValue: KNOWN_VALUE,
      newValue: NEW_VALUE,
    });
    backupPath = writeResult.backupPath;
  });

  after(() => {
    for (const p of [tmp, backupPath, tmp + '.trainer-tmp']) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  test('restores original value, returns restored:true + verifiedValue', async () => {
    const result = await rollbackWriteField({ filePath: tmp, backupPath, field: FIELD });
    assert.equal(result.restored, true);
    assert.equal(result.verifiedValue, KNOWN_VALUE);
  });

  test('file contains original value after rollback', () => {
    const content = fs.readFileSync(tmp, 'utf-8');
    assert.ok(content.includes(`<money>${KNOWN_VALUE}</money>`));
  });

  test('throws backup_not_found when backup is missing', async () => {
    await assert.rejects(
      () => rollbackWriteField({ filePath: tmp, backupPath: '/no/backup.xml', field: FIELD }),
      /backup_not_found/,
    );
  });

  test('throws invalid_params when field is missing', async () => {
    await assert.rejects(
      () => rollbackWriteField({ filePath: tmp, backupPath }),
      /invalid_params/,
    );
  });
});

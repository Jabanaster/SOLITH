import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDefaultRfsaBuffer,
  readRfsaFields,
  validateRfsaHeader,
  writeRfsaFields,
} from '../src/core/saves/binary-formats/rfsa.ts';
import {
  createDemoRfsaSave,
  readBinarySaveField,
  writeBinarySaveField,
} from '../src/core/saves/binary-save-field.ts';
import { detectBinarySaveProfile } from '../src/core/saves/binary-formats/index.ts';

describe('RFSA binary format', () => {
  test('default buffer validates and reads fields', () => {
    const buf = createDefaultRfsaBuffer();
    assert.equal(validateRfsaHeader(buf), true);
    const fields = readRfsaFields(buf);
    assert.equal(fields.gold, 500);
    assert.equal(fields.hp, 100);
  });

  test('writeRfsaFields updates checksum', () => {
    const base = createDefaultRfsaBuffer();
    const next = writeRfsaFields(base, { gold: 9999, hp: 50 });
    assert.equal(validateRfsaHeader(next), true);
    assert.equal(readRfsaFields(next).gold, 9999);
    assert.equal(readRfsaFields(next).hp, 50);
  });

  test('binary-save-field read/write round-trip on temp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfsa-'));
    const filePath = path.join(dir, 'player.rfsa');
    createDemoRfsaSave(filePath);

    const header = new Uint8Array(fs.readFileSync(filePath));
    const profile = detectBinarySaveProfile(filePath, header);
    assert.equal(profile?.id, 'rfsa-v1');

    const readGold = readBinarySaveField(filePath, 'gold');
    assert.equal(readGold.success, true);
    assert.equal(readGold.value, 500);

    const write = writeBinarySaveField(filePath, 'gold', 12345);
    assert.equal(write.success, true);
    const readAgain = readBinarySaveField(filePath, 'gold');
    assert.equal(readAgain.value, 12345);
  });
});

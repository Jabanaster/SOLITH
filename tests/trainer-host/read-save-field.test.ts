import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { readSaveField } from '../../src/core/trainer-host/read-save-field.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../demo-game/save/stardew-fixture.xml');

describe('readSaveField', () => {
  test('reads a known field from the XML fixture', async () => {
    const result = await readSaveField({ filePath: FIXTURE, field: 'SaveGame.player.0.money' });
    assert.equal(result.found, true);
    assert.equal(result.value, '5000');
  });

  test('reads a top-level string field', async () => {
    const result = await readSaveField({ filePath: FIXTURE, field: 'SaveGame.farmName' });
    assert.equal(result.found, true);
    assert.equal(result.value, 'TestFarm');
  });

  test('reads a nested numeric field as string', async () => {
    const result = await readSaveField({ filePath: FIXTURE, field: 'SaveGame.player.0.farmingLevel' });
    assert.equal(result.found, true);
    assert.equal(result.value, '3');
  });

  test('returns found=false for a missing field path', async () => {
    const result = await readSaveField({ filePath: FIXTURE, field: 'SaveGame.player.0.nonexistent' });
    assert.equal(result.found, false);
    assert.equal(result.value, null);
  });

  test('returns found=false for a nonexistent file', async () => {
    const result = await readSaveField({ filePath: '/no/such/file.xml', field: 'SaveGame.player.money' });
    assert.equal(result.found, false);
    assert.equal(result.value, null);
  });

  test('throws on invalid params (missing filePath)', async () => {
    await assert.rejects(
      () => readSaveField({ field: 'SaveGame.player.money' }),
      /invalid_params/,
    );
  });

  test('throws on invalid params (missing field)', async () => {
    await assert.rejects(
      () => readSaveField({ filePath: FIXTURE }),
      /invalid_params/,
    );
  });

  test('throws on invalid params (null)', async () => {
    await assert.rejects(
      () => readSaveField(null),
      /invalid_params/,
    );
  });

  test('throws xml_safety error on DOCTYPE with SYSTEM reference', async () => {
    const tmpPath = path.resolve(__dirname, '../../demo-game/save/doctype-fixture.xml');
    const fs = await import('fs');
    fs.writeFileSync(tmpPath, '<?xml version="1.0"?><!DOCTYPE foo SYSTEM "http://evil.com/evil.dtd"><foo/>');
    try {
      await assert.rejects(
        () => readSaveField({ filePath: tmpPath, field: 'foo' }),
        /xml_safety/,
      );
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});

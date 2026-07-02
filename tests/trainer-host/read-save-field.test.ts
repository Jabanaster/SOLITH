import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
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

  test('throws a user-safe unsupported-format error for non-XML save-field reads', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-private-read-'));
    const tmpPath = path.join(tmpDir, 'private-player.bin');
    fs.writeFileSync(tmpPath, '{"SaveGame":{"player":{"money":5000}}}', 'utf-8');
    try {
      await assert.rejects(
        () => readSaveField({ filePath: tmpPath, field: 'SaveGame.player.money' }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'UnsupportedSaveFormatError');
          assert.match(error.message, /unsupported/i);
          assert.match(error.message, /private-player\.bin/);
          assert.equal(error.message.includes(tmpDir), false);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('reads a simple field from JSON saves', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-json-read-'));
    const tmpPath = path.join(tmpDir, 'player.json');
    fs.writeFileSync(tmpPath, '{"player":{"money":5000},"stats":{"level":7}}', 'utf-8');
    try {
      const result = await readSaveField({ filePath: tmpPath, field: 'player.money' });
      assert.equal(result.found, true);
      assert.equal(result.value, '5000');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns found=false for missing JSON fields', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-json-missing-'));
    const tmpPath = path.join(tmpDir, 'player.json');
    fs.writeFileSync(tmpPath, '{"player":{"money":5000}}', 'utf-8');
    try {
      const result = await readSaveField({ filePath: tmpPath, field: 'player.stamina' });
      assert.equal(result.found, false);
      assert.equal(result.value, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('throws a safe malformed JSON error without full path leakage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-json-malformed-'));
    const tmpPath = path.join(tmpDir, 'private-player.json');
    fs.writeFileSync(tmpPath, '{"player":', 'utf-8');
    try {
      await assert.rejects(
        () => readSaveField({ filePath: tmpPath, field: 'player.money' }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /json_parse_error/);
          assert.equal(error.message.includes(tmpDir), false);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('rejects oversized JSON before parse with sanitized error', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resourceforge-json-oversize-'));
    const tmpPath = path.join(tmpDir, 'private-player.json');
    fs.writeFileSync(tmpPath, Buffer.alloc((8 * 1024 * 1024) + 1, 0x7b));
    try {
      await assert.rejects(
        () => readSaveField({ filePath: tmpPath, field: 'player.money' }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Save file is too large/i);
          assert.equal(error.message.includes(tmpDir), false);
          return true;
        },
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

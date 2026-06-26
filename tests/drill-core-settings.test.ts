/**
 * Drill Core `settings.json` master_volume adapter — sandbox pilot regression tests.
 *
 * Uses ONLY the sanitized fixture and synthetic GameMaker-style strings.
 * No real save data, paths, usernames, or pilot hashes appear here.
 *
 * Coverage:
 *  - Valid:        100.0→75.0, 100→75, boundary 0, boundary 100, UTF-8,
 *                  single-line preservation, exact backup restoration
 *  - Invalid:      missing/duplicate/nested key, wrong types, fractional,
 *                  negative, above-range, malformed, trailing data, BOM,
 *                  ambiguous token, stale value, wrong file, wrong target
 *  - Preservation: unrelated bytes/values preserved, numeric style preserved,
 *                  backup immutable, restore hash exact
 *  - Production:   real Renderer-equivalent engine path applyProposal +
 *                  restoreBackup with the narrow adapter selected via filename
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  DrillCoreSettingsAdapter,
  findMasterVolumeToken,
  applyMasterVolume,
  validateMasterVolume,
} from '../src/core/adapters/drill-core-settings.ts';
import { getAdapterForFile } from '../src/core/adapters/index.ts';

import db, { initDatabase } from '../src/core/database/index.ts';
import { addGame } from '../src/core/games/index.ts';
import { createRecipe } from '../src/core/recipes/index.ts';
import { createProposalForEdit, applyProposal } from '../src/core/saves/editor.ts';
import { restoreBackup } from '../src/core/backups/index.ts';

// GameMaker-style real-number serialization (single line, trailing .0).
const SAMPLE_REAL = '{"master_volume":100.0,"music_volume":65.0,"effects_volume":100.0,"vsync":1.0,"show_fps":0.0}';
const SAMPLE_INT  = '{"master_volume":100,"music_volume":65,"vsync":1}';

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALID
// ─────────────────────────────────────────────────────────────────────────────

describe('drill-core-settings — valid edits', () => {
  test('dc-valid-01 — 100.0 → 75.0 preserves decimal style and all other bytes', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 75, 100);
    assert.equal(res.success, true, res.error);
    assert.equal(res.content, '{"master_volume":75.0,"music_volume":65.0,"effects_volume":100.0,"vsync":1.0,"show_fps":0.0}');
    assert.equal(res.evidence?.originalToken, '100.0');
    assert.equal(res.evidence?.replacementToken, '75.0');
    assert.equal(res.evidence?.changedRegions, 1);
    assert.equal(res.evidence?.prefixEqual, true);
    assert.equal(res.evidence?.suffixEqual, true);

    const before = JSON.parse(SAMPLE_REAL);
    const after = JSON.parse(res.content!);
    assert.equal(after.master_volume, 75);
    for (const k of Object.keys(before)) {
      if (k === 'master_volume') continue;
      assert.equal(after[k], before[k], `unrelated value ${k} unchanged`);
    }
    assert.deepEqual(Object.keys(after), Object.keys(before), 'no keys added/removed');
  });

  test('dc-valid-02 — 100 → 75 preserves integer style', () => {
    const res = applyMasterVolume(SAMPLE_INT, 75, 100);
    assert.equal(res.success, true, res.error);
    assert.equal(res.content, '{"master_volume":75,"music_volume":65,"vsync":1}');
    assert.equal(res.evidence?.originalToken, '100');
    assert.equal(res.evidence?.replacementToken, '75');
  });

  test('dc-valid-03 — boundary 0 accepted', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 0, 100);
    assert.equal(res.success, true, res.error);
    assert.equal(JSON.parse(res.content!).master_volume, 0);
    assert.equal(res.evidence?.replacementToken, '0.0');
  });

  test('dc-valid-04 — boundary 100 accepted (no semantic change)', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 100, 100);
    assert.equal(res.success, true, res.error);
    assert.equal(res.content, SAMPLE_REAL, 'content identical when value unchanged');
  });

  test('dc-valid-05 — UTF-8 content outside target is preserved', () => {
    const utf = '{"label":"caf\u00e9 \u2602","master_volume":100.0}';
    const res = applyMasterVolume(utf, 75, 100);
    assert.equal(res.success, true, res.error);
    assert.equal(res.content, '{"label":"caf\u00e9 \u2602","master_volume":75.0}');
    assert.equal(JSON.parse(res.content!).label, 'caf\u00e9 \u2602');
  });

  test('dc-valid-06 — single-line formatting preserved (no newlines introduced)', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 75, 100);
    assert.equal(res.success, true, res.error);
    assert.equal(res.content!.includes('\n'), false);
    assert.equal(res.content!.includes('  '), false, 'no pretty-print indentation');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVALID
// ─────────────────────────────────────────────────────────────────────────────

describe('drill-core-settings — invalid edits rejected', () => {
  test('dc-invalid-01 — missing key', () => {
    const r = findMasterVolumeToken('{"music_volume":65.0}');
    assert.equal(r.ok, false);
  });

  test('dc-invalid-02 — duplicate key is ambiguous', () => {
    const r = findMasterVolumeToken('{"master_volume":100.0,"master_volume":50.0}');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /[Aa]mbiguous/);
  });

  test('dc-invalid-03 — nested-only key rejected (not top-level)', () => {
    const r = findMasterVolumeToken('{"audio":{"master_volume":100.0}}');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not found/i);
  });

  test('dc-invalid-04 — wrong types rejected', () => {
    for (const bad of ['"100"', 'true', 'null', '{"x":1}', '[1,2]']) {
      const r = findMasterVolumeToken(`{"master_volume":${bad}}`);
      assert.equal(r.ok, false, `type ${bad} should be rejected`);
    }
  });

  test('dc-invalid-05 — fractional proposal rejected', () => {
    assert.equal(validateMasterVolume(75.5).ok, false);
    assert.equal(applyMasterVolume(SAMPLE_REAL, 75.5, 100).success, false);
  });

  test('dc-invalid-06 — negative proposal rejected', () => {
    assert.equal(validateMasterVolume(-1).ok, false);
    assert.equal(applyMasterVolume(SAMPLE_REAL, -1, 100).success, false);
  });

  test('dc-invalid-07 — above-range proposal rejected', () => {
    assert.equal(validateMasterVolume(101).ok, false);
    assert.equal(applyMasterVolume(SAMPLE_REAL, 101, 100).success, false);
  });

  test('dc-invalid-08 — malformed JSON rejected', () => {
    const r = findMasterVolumeToken('{"master_volume":100.0');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Malformed/);
  });

  test('dc-invalid-09 — trailing data rejected', () => {
    const r = findMasterVolumeToken('{"master_volume":100.0}garbage');
    assert.equal(r.ok, false);
  });

  test('dc-invalid-10 — unexpected BOM rejected', () => {
    const r = findMasterVolumeToken('\uFEFF' + SAMPLE_REAL);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /BOM/);
  });

  test('dc-invalid-11 — stale value rejected', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 75, 50); // expected old 50, real is 100
    assert.equal(res.success, false);
    assert.match(res.error || '', /[Ss]tale/);
  });

  test('dc-invalid-12 — adapter rejects wrong target path', async () => {
    const a = new DrillCoreSettingsAdapter();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-wrongtarget-'));
    const f = path.join(dir, 'settings.json');
    fs.writeFileSync(f, SAMPLE_REAL, 'utf8');
    const out = await a.buildOutput(f, 'music_volume', 50);
    assert.equal(out.success, false);
    assert.match(out.error || '', /Unsupported target/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('dc-invalid-13 — adapter does not support non-settings filenames', () => {
    const a = new DrillCoreSettingsAdapter();
    assert.equal(a.supports('save.json'), false);
    assert.equal(a.supports('config/settings.json'), true);
    assert.equal(a.supports('SETTINGS.JSON'), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRESERVATION
// ─────────────────────────────────────────────────────────────────────────────

describe('drill-core-settings — byte/value preservation', () => {
  test('dc-pres-01 — unrelated bytes before/after token are identical', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 75, 100);
    assert.equal(res.success, true, res.error);
    const [start] = res.evidence!.originalSpan;
    assert.equal(res.content!.slice(0, start), SAMPLE_REAL.slice(0, start), 'prefix identical');
    const origSuffix = SAMPLE_REAL.slice(res.evidence!.originalSpan[1]);
    const newSuffix = res.content!.slice(res.evidence!.modifiedSpan[1]);
    assert.equal(newSuffix, origSuffix, 'suffix identical');
  });

  test('dc-pres-02 — only one region changes, length delta matches token delta', () => {
    const res = applyMasterVolume(SAMPLE_REAL, 75, 100); // 100.0(5) -> 75.0(4) = -1
    assert.equal(res.success, true, res.error);
    assert.equal(SAMPLE_REAL.length - res.content!.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION ENGINE PATH (the same functions the IPC layer invokes)
// ─────────────────────────────────────────────────────────────────────────────

describe('drill-core-settings — production apply/restore engine', () => {
  const gameDir = path.join(os.tmpdir(), `rf-drillcore-engine-${Date.now()}`);
  const target = path.join(gameDir, 'settings.json');
  let gameId = '';

  before(async () => {
    await initDatabase();
    fs.mkdirSync(gameDir, { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'drill-core-settings.fixture.json'), target);
    const game = addGame({ name: 'Drill Core (sandbox fixture)', path: gameDir, engine: 'GameMaker' as any });
    gameId = game.id;
  });

  after(() => {
    try { fs.rmSync(gameDir, { recursive: true, force: true }); } catch {}
  });

  test('dc-engine-01 — narrow adapter is selected for settings.json', () => {
    const adapter = getAdapterForFile(target);
    assert.ok(adapter);
    assert.equal(adapter!.id, 'drill-core-settings');
  });

  test('dc-engine-02 — Master Volume slider recipe validates and persists', () => {
    const recipe = createRecipe({
      gameId,
      name: 'Master Volume',
      category: 'Audio',
      source: 'pilot',
      target,
      path: 'master_volume',
      valueType: 'number',
      risk: 'Low',
      requiresBackup: true,
      confidence: 1,
      description: 'Drill Core master volume (sandbox pilot)',
      adapterId: 'drill-core-settings',
      adapterVersion: '1.0.0',
      inputType: 'slider',
      minimum: 0,
      maximum: 100,
      step: 1,
      resetValue: 100,
    } as any);
    assert.equal(recipe.name, 'Master Volume');
    assert.equal(recipe.minimum, 0);
    assert.equal(recipe.maximum, 100);
  });

  test('dc-engine-03 — full proposal → backup → apply → validate → restore', async () => {
    const preWriteHash = sha256(fs.readFileSync(target));

    const proposal = createProposalForEdit(gameId, target, 'master_volume', 100, 75);
    const applied = await applyProposal(proposal);
    assert.equal(applied.success, true, applied.error);
    assert.ok(applied.backup);

    // Post-write validation
    const afterRaw = fs.readFileSync(target, 'utf8');
    const afterParsed = JSON.parse(afterRaw);
    assert.equal(afterParsed.master_volume, 75, 'master_volume applied');
    assert.equal(afterRaw.includes('75.0'), true, 'GameMaker decimal style preserved');
    assert.equal(afterParsed.music_volume, 65, 'unrelated value unchanged');
    assert.equal(afterParsed.effects_volume, 100, 'unrelated value unchanged');
    assert.equal(afterRaw.includes('\n'), false, 'single-line format preserved');

    // Backup hash equals pre-write working hash
    const backupHash = sha256(fs.readFileSync(applied.backup!.backupPath));
    assert.equal(backupHash, preWriteHash, 'verified backup == pre-write working file');

    // Exact restore
    const restored = restoreBackup(applied.backup!);
    assert.equal(restored, true, 'restore succeeded');
    const restoredHash = sha256(fs.readFileSync(target));
    assert.equal(restoredHash, preWriteHash, 'restored hash == pre-write hash (exact)');
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).master_volume, 100, 'restored to 100');

    // Backup remains intact after restore
    assert.equal(sha256(fs.readFileSync(applied.backup!.backupPath)), preWriteHash, 'backup immutable');
  });
});

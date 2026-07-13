import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeTrainerExecutable } from '../src/core/trainer-research/pe-analyzer.ts';
import { exportCandidatesToCheatTableXml } from '../src/core/trainer-research/ct-export.ts';
import { buildSchemaDraftFromCandidates } from '../src/core/trainer-research/schema-draft.ts';
import { buildTrainerResearchExportBundle } from '../src/core/trainer-research/index.ts';

function writeTempExe(name: string, bytes: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-research-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

describe('trainer-research PE analyzer', () => {
  it('rejects non-exe extensions', () => {
    const filePath = writeTempExe('trainer.bin', Buffer.from('MZ'));
    assert.throws(() => analyzeTrainerExecutable(filePath), /Only \.exe files/);
  });

  it('reports non-PE payloads without executing', () => {
    const filePath = writeTempExe('trainer.exe', Buffer.from('not a pe file at all'));
    const report = analyzeTrainerExecutable(filePath);
    assert.equal(report.isPe, false);
    assert.ok(report.sha256.length === 64);
    assert.ok(report.warnings.some((w) => /never executes/i.test(w)));
  });

  it('parses minimal DOS header payloads', () => {
    const buf = Buffer.alloc(128);
    buf.writeUInt16LE(0x5a4d, 0);
    buf.writeUInt32LE(0x40, 0x3c);
    const filePath = writeTempExe('Palworld.Trainer-FLiNG.exe', buf);
    const report = analyzeTrainerExecutable(filePath);
    assert.equal(report.isPe, false);
    assert.equal(report.fileName, 'Palworld.Trainer-FLiNG.exe');
  });
});

describe('trainer-research exports', () => {
  const candidates = [
    {
      id: 'research-1',
      address: '0x7FF612340000',
      dataType: 'float',
      baselineValue: 100,
      currentValue: 9999,
      label: 'God Mode',
      category: 'Player',
    },
  ];

  it('exports Cheat Engine XML without scripts', () => {
    const xml = exportCandidatesToCheatTableXml('Palworld Research', candidates, {
      gameExecutable: 'Palworld-Win64-Shipping.exe',
    });
    assert.match(xml, /<CheatTable/);
    assert.match(xml, /God Mode/);
    assert.match(xml, /0x7FF612340000/);
    assert.equal(xml.includes('AutoAssembler'), false);
  });

  it('builds schema.v1 draft with scan_unknown features', () => {
    const definition = buildSchemaDraftFromCandidates({
      title: 'Palworld Research',
      gameExecutable: 'Palworld-Win64-Shipping.exe',
      candidates,
    });
    assert.equal(definition.memoryFeatures?.length, 1);
    assert.equal(definition.memoryFeatures?.[0]?.type, 'scan_unknown');
    assert.equal(definition.safety.requiresOfflineConfirm, true);
  });

  it('bundles CT + schema exports together', () => {
    const bundle = buildTrainerResearchExportBundle({
      title: 'Palworld Research',
      gameExecutable: 'Palworld-Win64-Shipping.exe',
      candidates,
    });
    assert.equal(bundle.candidateCount, 1);
    assert.ok(bundle.ctXml.includes('CheatTable'));
    assert.ok(bundle.schemaJson.includes('schemaVersion'));
  });
});

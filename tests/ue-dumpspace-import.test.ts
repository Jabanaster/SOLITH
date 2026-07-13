import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../src/core/database/index.ts';
import { importDefinitionDumpspace } from '../src/core/definitions/import-definition-dumpspace.ts';
import {
  buildDumpspaceImportSummary,
  findCheatRelevantMembers,
  parseDumpspaceClassesJson,
  parseDumpspaceOffsetsJson,
} from '../src/core/ue-research/dumpspace-import.ts';
import { UEDUMPER_REFERENCE } from '../src/core/ue-research/types.ts';

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/ue-dumpspace-minimal',
);

describe('ue-dumpspace import', () => {
  before(async () => {
    await initDatabase();
  });

  test('parses OffsetsInfo.json tuples', () => {
    const json = fs.readFileSync(path.join(fixtureDir, 'OffsetsInfo.json'), 'utf8');
    const parsed = parseDumpspaceOffsetsJson(json);
    assert.equal(parsed.offsets.length, 3);
    assert.equal(parsed.offsets[0]?.name, 'OFFSET_GNAMES');
    assert.equal(parsed.credit?.dumper_used, 'UEDumper');
  });

  test('parses class members and finds cheat-relevant fields', () => {
    const json = fs.readFileSync(path.join(fixtureDir, 'ClassesInfo.json'), 'utf8');
    const members = parseDumpspaceClassesJson(json);
    assert.ok(members.length >= 5);
    const hits = findCheatRelevantMembers(members);
    assert.ok(hits.some((m) => m.memberName === 'CurrentHP'));
    assert.ok(hits.some((m) => m.memberName === 'Money'));
    assert.ok(hits.some((m) => m.memberName === 'AttackPower'));
  });

  test('builds import summary with offsets and candidates', () => {
    const summary = buildDumpspaceImportSummary({
      title: 'Palworld UE Research',
      executable: 'Palworld-Win64-Shipping.exe',
      offsetsJson: fs.readFileSync(path.join(fixtureDir, 'OffsetsInfo.json'), 'utf8'),
      classesJson: fs.readFileSync(path.join(fixtureDir, 'ClassesInfo.json'), 'utf8'),
    });
    assert.equal(summary.catalogGameId, 'palworld-ue-research');
    assert.equal(summary.ueOffsets.length, 3);
    assert.ok(summary.cheatCandidates.length >= 4);
    assert.equal(summary.classCount, 2);
  });

  test('imports Dumpspace folder into trainer catalog', () => {
    const result = importDefinitionDumpspace({
      dumpspaceDir: fixtureDir,
      title: 'Palworld UE Research',
      executable: 'Palworld-Win64-Shipping.exe',
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.catalogGameId, 'palworld-ue-research');
      assert.ok(result.cheatCount >= 4);
      assert.equal(result.offsetCount, 3);
      assert.ok(result.notes.some((n) => /UEDumper/i.test(n)));
    }
  });

  test('documents upstream UEDumper reference constraints', () => {
    assert.equal(UEDUMPER_REFERENCE.repository, 'https://github.com/Spuckwaffel/UEDumper');
    assert.ok(UEDUMPER_REFERENCE.dumpspaceFiles.includes('Dumpspace/OffsetsInfo.json'));
    assert.ok(UEDUMPER_REFERENCE.solithDoesNotBundle.some((s) => /driver/i.test(s)));
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  evaluateCtLibraryEntryForPromotion,
  promoteCtLibraryEntry,
  type CtLibraryCheat,
} from '../../src/core/ct-library/promote-bridge.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SUMMARY_PATH = path.join(ROOT, 'data', 'ct-library', 'personal-ct-library.summary.json');

interface Shard {
  tables: Array<{
    tableName: string;
    archivePath: string;
    sourceSha256: string;
    cheats: CtLibraryCheat[];
  }>;
}

async function loadShardForGame(gameId: string): Promise<Shard> {
  const summary = JSON.parse(await fs.readFile(SUMMARY_PATH, 'utf8'));
  const shardEntry = summary.shards.find((s: { gameId: string }) => s.gameId === gameId);
  assert.ok(shardEntry, `expected a shard entry for ${gameId} in the live corpus`);
  const shardPath = path.isAbsolute(shardEntry.path) ? shardEntry.path : path.join(ROOT, shardEntry.path);
  return JSON.parse(await fs.readFile(shardPath, 'utf8'));
}

function findFirstResolvablePointer(shard: Shard) {
  for (const table of shard.tables) {
    for (const cheat of table.cheats) {
      if (cheat.kind === 'pointer' && cheat.metadata?.liveResolution === 'resolvable') {
        return { table, cheat };
      }
    }
  }
  return null;
}

describe('CT Library -> Trainer Deck bridge — real corpus vertical slices', () => {
  test('Stardew Valley: a real native-ready library record promotes end-to-end', async () => {
    const shard = await loadShardForGame('stardew-valley');
    const found = findFirstResolvablePointer(shard);
    assert.ok(found, 'stardew-valley must have at least one resolvable pointer record (audit found 68)');
    const { table, cheat } = found!;

    const attempt = promoteCtLibraryEntry(
      { gameId: 'stardew-valley', displayName: 'Stardew Valley' },
      { tableName: table.tableName, archivePath: table.archivePath, sourceSha256: table.sourceSha256 },
      cheat,
    );

    assert.equal(attempt.eligible, true);
    if (!attempt.eligible) return;
    assert.equal(attempt.result.candidate.liveResolution, 'resolvable');
    assert.equal(attempt.result.trainerPack.mappings.length, 1);
    assert.equal(attempt.result.trainerPack.airGap.requiresLogin, false);
    assert.equal(attempt.result.card.freezeEligible, true);
    assert.equal(attempt.result.card.moduleName, cheat.metadata!.moduleName);
    assert.equal(attempt.result.provenance.gameId, 'stardew-valley');
    assert.equal(attempt.result.provenance.sourceSha256, table.sourceSha256);
  });

  test('Subnautica: a real 100%-native-ready library record promotes end-to-end', async () => {
    const shard = await loadShardForGame('subnautica');
    const found = findFirstResolvablePointer(shard);
    assert.ok(found, 'subnautica must have at least one resolvable pointer record (audit found 4/4)');
    const { table, cheat } = found!;

    const attempt = promoteCtLibraryEntry(
      { gameId: 'subnautica', displayName: 'Subnautica' },
      { tableName: table.tableName, archivePath: table.archivePath, sourceSha256: table.sourceSha256 },
      cheat,
    );

    assert.equal(attempt.eligible, true);
    if (!attempt.eligible) return;
    assert.equal(attempt.result.candidate.liveResolution, 'resolvable');
    assert.equal(attempt.result.card.freezeEligible, true);
    assert.equal(attempt.result.provenance.gameId, 'subnautica');
    assert.equal(attempt.result.provenance.cheatName, cheat.name);
  });

  test('every non-native-ready Subnautica-shaped entry would be refused (spot check across whole shard)', async () => {
    const shard = await loadShardForGame('subnautica');
    for (const table of shard.tables) {
      for (const cheat of table.cheats) {
        const evaluation = evaluateCtLibraryEntryForPromotion(cheat);
        const shouldBeEligible = cheat.kind === 'pointer' && cheat.metadata?.liveResolution === 'resolvable';
        assert.equal(evaluation.eligible, shouldBeEligible, `mismatch for cheat ${cheat.id}`);
      }
    }
  });
});

describe('CT Library -> Trainer Deck bridge — negative security matrix (fail-closed)', () => {
  const baselinePointer: CtLibraryCheat = {
    id: 'ptr-1',
    name: 'Health',
    kind: 'pointer',
    executable: false,
    certificationLevel: 'L0',
    metadata: {
      dataType: 'float',
      moduleName: 'Game.exe',
      rawAddress: '"Game.exe"+1000',
      baseOffset: '0x1000',
      pointerChain: [0x10],
      liveResolution: 'resolvable',
      showAsHex: false,
    },
  };

  test('script-dependent (Auto Assembler) entry is refused', () => {
    const cheat: CtLibraryCheat = {
      id: 'script-1', name: 'AA Script', kind: 'script', executable: false, certificationLevel: 'L0',
      metadata: { scriptType: 'autoassembler', scriptExcerpt: '[ENABLE]\nlabel(x)' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Script-dependent/);
  });

  test('Lua entry is refused', () => {
    const cheat: CtLibraryCheat = {
      id: 'script-2', name: 'Lua Script', kind: 'script', executable: false, certificationLevel: 'L0',
      metadata: { scriptType: 'lua', scriptExcerpt: 'print("hi")' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Lua/);
  });

  test('AOB signature entry is refused', () => {
    const cheat: CtLibraryCheat = {
      id: 'aob-1', name: 'Signature', kind: 'aob', executable: false, certificationLevel: 'L0',
      metadata: { symbol: 'HEALTH_READ', moduleName: 'Game.exe', scanType: 'exact', pattern: 'AA BB CC' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /AOB/);
  });

  test('incomplete pointer is refused', () => {
    const cheat: CtLibraryCheat = {
      ...baselinePointer,
      metadata: { ...baselinePointer.metadata, liveResolution: 'incomplete' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Incomplete pointer/);
  });

  test('missing module is refused', () => {
    const cheat: CtLibraryCheat = {
      ...baselinePointer,
      metadata: { ...baselinePointer.metadata, moduleName: 'unknown-module.exe' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Missing module/);
  });

  test('malformed base offset is refused', () => {
    const cheat: CtLibraryCheat = {
      ...baselinePointer,
      metadata: { ...baselinePointer.metadata, baseOffset: 'not-a-hex-offset' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Malformed base offset/);
  });

  test('malformed pointer chain is refused', () => {
    const cheat: CtLibraryCheat = {
      ...baselinePointer,
      metadata: { ...baselinePointer.metadata, pointerChain: ['not', 'numbers'] as unknown as number[] },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Malformed pointer chain/);
  });

  test('unknown resolver state (absolute_only) is refused', () => {
    const cheat: CtLibraryCheat = {
      ...baselinePointer,
      metadata: { ...baselinePointer.metadata, liveResolution: 'absolute_only' },
    };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Absolute\/session-only/);
  });

  test('non-native-ready (missing metadata entirely) is refused', () => {
    const cheat: CtLibraryCheat = { id: 'ptr-x', name: 'X', kind: 'pointer', executable: false, certificationLevel: 'L0' };
    const result = evaluateCtLibraryEntryForPromotion(cheat);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.match(result.reason, /Missing resolver metadata/);
  });

  test('the eligible baseline pointer IS accepted (control case)', () => {
    const result = evaluateCtLibraryEntryForPromotion(baselinePointer);
    assert.equal(result.eligible, true);
  });

  test('refused entries never reach promoteCandidateFromCtEntry / never produce a card', () => {
    const scriptCheat: CtLibraryCheat = {
      id: 'script-3', name: 'AA', kind: 'script', executable: false, certificationLevel: 'L0',
      metadata: { scriptType: 'autoassembler' },
    };
    const attempt = promoteCtLibraryEntry(
      { gameId: 'g', displayName: 'G' },
      { tableName: 't', archivePath: 'a', sourceSha256: 'h' },
      scriptCheat,
    );
    assert.equal(attempt.eligible, false);
    // No candidate/card/trainerPack object exists on a refusal — nothing to attach/write with.
    assert.equal('result' in attempt, false);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCtLiveResolution,
  featureTypeForCtLiveResolution,
  parseCheatTableXml,
} from '../../src/core/definitions/ct-import.js';
import {
  buildLiveToggleCards,
  promoteCandidateFromCtEntry,
} from '../../src/core/live-memory/ct-promote.js';
import {
  buildLocalTrainerPack,
  parseLocalTrainerPack,
  serializeLocalTrainerPack,
} from '../../src/core/live-memory/local-pack-export.js';

describe('CtLiveResolution + promote + local pack', () => {
  test('classifies module+offset as resolvable and freeze-eligible', () => {
    const q = classifyCtLiveResolution({
      moduleName: 'Game.exe',
      baseOffset: '0x1a2b3c',
      pointerChain: [0x18, 0],
    });
    assert.equal(q, 'resolvable');
    assert.equal(featureTypeForCtLiveResolution(q, true), 'freeze');
  });

  test('absolute / unknown-module is absolute_only and never freezes', () => {
    const q = classifyCtLiveResolution({
      moduleName: 'unknown-module.exe',
      rawAddress: '0x12345678',
    });
    assert.equal(q, 'absolute_only');
    assert.equal(featureTypeForCtLiveResolution(q, true), 'scan_unknown');
  });

  test('parseCheatTableXml stamps liveResolution on accepted entries', async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"Player Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"Game.exe"+1A2B3C</Address>
      <Offsets><Offset>18</Offset></Offsets>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;
    const result = await parseCheatTableXml(xml, { title: 'Res Game' });
    assert.equal(result.accepted[0].liveResolution, 'resolvable');
    assert.equal(result.definition.memoryFeatures?.[0].type, 'freeze');
  });

  test('toggle cards mark absolute_only as not freezeEligible', () => {
    const cards = buildLiveToggleCards([
      {
        id: 'a',
        label: 'Abs',
        dataType: 'int32',
        moduleName: 'unknown-module.exe',
        pointerChain: [],
        liveResolution: 'absolute_only',
        defaultValue: 1,
        source: 'ct-import',
      },
      {
        id: 'b',
        label: 'Ptr',
        dataType: 'float',
        moduleName: 'Game.exe',
        baseOffset: '0x1000',
        pointerChain: [8],
        liveResolution: 'resolvable',
        defaultValue: 100,
        source: 'ct-import',
      },
    ]);
    assert.equal(cards.find((c) => c.id === 'a')?.freezeEligible, false);
    assert.equal(cards.find((c) => c.id === 'b')?.freezeEligible, true);
  });

  test('local pack export is air-gap marked and round-trips', () => {
    const entry = {
      id: 'health',
      name: 'Health',
      category: 'Imported',
      dataType: 'float' as const,
      moduleName: 'Game.exe',
      rawAddress: '"Game.exe"+1000',
      baseOffset: '0x1000',
      pointerChain: [0x10],
      showAsHex: false,
      liveResolution: 'resolvable' as const,
    };
    const pack = buildLocalTrainerPack({
      catalogGameId: 'game',
      title: 'Game',
      mappings: [promoteCandidateFromCtEntry(entry)],
    });
    assert.equal(pack.airGap.requiresLogin, false);
    assert.equal(pack.airGap.requiresCloudAllowList, false);
    assert.equal(pack.mappings.length, 1);
    const again = parseLocalTrainerPack(serializeLocalTrainerPack(pack));
    assert.equal(again.catalogGameId, 'game');
    assert.equal(again.mappings[0].id, 'health');
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCheatTableXml } from '../src/core/definitions/ct-import.ts';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"Player Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"Game.exe"+1A2B3C</Address>
      <Offsets>
        <Offset>18</Offset>
        <Offset>0</Offset>
      </Offsets>
    </CheatEntry>
    <CheatEntry>
      <Description>"God Mode Script"</Description>
      <VariableType>4 Bytes</VariableType>
      <Address>12345678</Address>
      <AutoAssemblerScript>nop</AutoAssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

describe('ct-import', () => {
  test('parses memory entries and rejects script cheats', async () => {
    const result = await parseCheatTableXml(SAMPLE_CT, { title: 'Test Game' });
    assert.equal(result.accepted.length, 1);
    assert.equal(result.accepted[0].name, 'Player Health');
    assert.equal(result.accepted[0].dataType, 'float');
    assert.equal(result.accepted[0].pointerChain.length, 2);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /AutoAssembler/);
    assert.equal(result.definition.memoryFeatures?.length, 1);
    assert.equal(result.errors.length, 0);
  });

  test('rejects invalid xml', async () => {
    const result = await parseCheatTableXml('<not-a-table>', { title: 'Broken' });
    assert.equal(result.accepted.length, 0);
    assert.ok(result.errors.includes('xml_parse_error') || result.errors.includes('missing_CheatTable_root'));
  });
});

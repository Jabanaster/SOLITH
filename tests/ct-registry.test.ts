import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileSolithCtRegistry } from '../src/core/registry/compile-ct-registry.ts';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Avowed</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <Description>"Player Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"Avowed-Win64-Shipping.exe"+1234</Address>
      <Offsets>
        <Offset>18</Offset>
      </Offsets>
    </CheatEntry>
    <CheatEntry>
      <Description>"Create Console"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(console,Avowed-Win64-Shipping.exe,48 8B ?? ??)
[DISABLE]</CheatScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

describe('compileSolithCtRegistry', () => {
  test('combines pointer import and inert script catalog into one JSON payload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    const outPath = path.join(dir, 'Avowed_Master_Registry.json');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const registry = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      outputJsonPath: outPath,
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.equal(registry.schemaVersion, '1.0.0');
    assert.equal(registry.game, 'Avowed');
    assert.equal(registry.sourceFile, 'Avowed.CT');
    assert.equal(registry.metadata.totalPointers, 1);
    assert.equal(registry.metadata.totalScripts, 1);
    assert.equal(registry.pointers.accepted[0]?.name, 'Player Health');
    assert.equal(registry.scripts.scripts[0]?.name, 'Create Console');
    assert.equal(registry.scripts.scripts[0]?.executable, false);

    const written = JSON.parse(fs.readFileSync(outPath, 'utf8')) as typeof registry;
    assert.equal(written.metadata.totalPointers, 1);
    assert.equal(written.scripts.scripts[0]?.executable, false);
  });
});

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
aobscan(globalConsole,48 8B * AA)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"No Signature Script"</Description>
      <CheatScript>[ENABLE]
registersymbol(noSignatureOnly)
[DISABLE]</CheatScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

const EDGE_CASE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatTableTitle>Avowed</CheatTableTitle>
  <CheatEntries>
    <CheatEntry>
      <Description>"Duplicate One"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(firstDup,Avowed-Win64-Shipping.exe,AA BB ?? CC)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"Duplicate Two"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(secondDup,Avowed-Win64-Shipping.exe,AA BB ?? CC)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"Malformed"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(badSig,Avowed-Win64-Shipping.exe,AA ZZ)
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
    assert.equal(registry.metadata.totalScripts, 2);
    assert.equal(registry.metadata.totalAobSignatures, 2);
    assert.equal(registry.metadata.aobWarnings, 1);
    assert.equal(registry.metadata.duplicateAobSignatures, 0);
    assert.equal(registry.pointers.accepted[0]?.name, 'Player Health');
    assert.equal(registry.scripts.scripts[0]?.name, 'Create Console');
    assert.equal(registry.scripts.scripts[0]?.executable, false);
    assert.equal(registry.scripts.scripts[1]?.name, 'No Signature Script');
    assert.equal(registry.aobSignatures.length, 2);
    assert.equal(registry.aobSignatures[0]?.symbol, 'console');
    assert.equal(registry.aobSignatures[0]?.module, 'Avowed-Win64-Shipping.exe');
    assert.equal(registry.aobSignatures[0]?.scanType, 'aobscanmodule');
    assert.equal(registry.aobSignatures[0]?.pattern, '48 8B ?? ??');
    assert.equal(registry.aobSignatures[0]?.normalizedPattern, '48 8B ?? ??');
    assert.equal(registry.aobSignatures[0]?.sourceEntryDescription, 'Create Console');
    assert.equal(registry.aobSignatures[0]?.sourceScriptIndex, 0);
    assert.equal(registry.aobSignatures[0]?.sourceEntryId, 'ct-script-0-create-console');
    assert.equal(registry.aobSignatures[0]?.executable, false);
    assert.equal(registry.aobSignatures[1]?.symbol, 'globalConsole');
    assert.equal(registry.aobSignatures[1]?.module, null);
    assert.equal(registry.aobSignatures[1]?.normalizedPattern, '48 8B * AA');
    assert.match(registry.aobSignatures[1]?.warnings.join('\n') ?? '', /does not declare a module/);
    assert.deepEqual(registry.rejections, registry.pointers.rejected);

    const written = JSON.parse(fs.readFileSync(outPath, 'utf8')) as typeof registry;
    assert.equal(written.metadata.totalPointers, 1);
    assert.equal(written.scripts.scripts[0]?.executable, false);
    assert.equal(written.aobSignatures.length, 2);
  });

  test('produces deterministic AOB IDs across repeated compilation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');

    const first = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });
    const second = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-21T00:00:00.000Z',
    });

    assert.deepEqual(
      first.aobSignatures.map((signature) => signature.id),
      second.aobSignatures.map((signature) => signature.id),
    );
  });

  test('keeps malformed and duplicate AOB signatures traceable without crashing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ct-registry-'));
    const ctPath = path.join(dir, 'Avowed.CT');
    fs.writeFileSync(ctPath, EDGE_CASE_CT, 'utf8');

    const registry = await compileSolithCtRegistry(ctPath, {
      game: 'Avowed',
      title: 'Avowed',
      compiledAt: '2026-07-20T00:00:00.000Z',
    });

    assert.equal(registry.metadata.totalPointers, 0);
    assert.equal(registry.metadata.totalScripts, 3);
    assert.equal(registry.metadata.totalAobSignatures, 3);
    assert.equal(registry.metadata.duplicateAobSignatures, 1);
    assert.ok(registry.metadata.aobWarnings >= 2);

    const duplicate = registry.aobSignatures.find((signature) => signature.symbol === 'secondDup');
    assert.equal(duplicate?.duplicateOf, 'firstDup');
    assert.match(duplicate?.warnings.join('\n') ?? '', /Duplicate signature pattern/);

    const malformed = registry.aobSignatures.find((signature) => signature.symbol === 'badSig');
    assert.equal(malformed?.completeness, 'invalid');
    assert.match(malformed?.warnings.join('\n') ?? '', /Invalid AOB token "ZZ"/);
  });
});

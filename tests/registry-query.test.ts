import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileSolithCtRegistry } from '../src/core/registry/compile-ct-registry.ts';
import { getRegistryEntry, searchRegistry } from '../src/core/registry/query-registry.ts';
import { loadRegistry, validateLoadedRegistry } from '../src/core/registry/load-registry.ts';

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
      <Description>"Health Script"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(playerHealth,Avowed-Win64-Shipping.exe,48 8B ?? * 89)
aobscan(globalEssence,AA BB ?? CC)
[DISABLE]</CheatScript>
    </CheatEntry>
    <CheatEntry>
      <Description>"Malformed Script"</Description>
      <CheatScript>[ENABLE]
aobscanmodule(badSig,Avowed-Win64-Shipping.exe,AA ZZ)
[DISABLE]</CheatScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

async function makeRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-registry-query-'));
  const ctPath = path.join(dir, 'Avowed.CT');
  const outPath = path.join(dir, 'registry.json');
  fs.writeFileSync(ctPath, SAMPLE_CT, 'utf8');
  const registry = await compileSolithCtRegistry(ctPath, {
    game: 'Avowed',
    title: 'Avowed',
    outputJsonPath: outPath,
    compiledAt: '2026-07-20T00:00:00.000Z',
  });
  return { registry, outPath, dir };
}

describe('registry query layer', () => {
  test('loads and validates compiled registry artifacts', async () => {
    const { registry, outPath } = await makeRegistry();
    const loaded = await loadRegistry(outPath);

    assert.deepEqual(loaded, registry);
    assert.equal(validateLoadedRegistry(loaded).schemaVersion, '1.0.0');
  });

  test('searches exact, case-insensitive, and partial text across result types', async () => {
    const { registry } = await makeRegistry();

    assert.equal(searchRegistry(registry, { text: 'Player Health', type: 'pointer' }).length, 1);
    assert.equal(searchRegistry(registry, { text: 'player health', type: 'pointer' }).length, 1);
    assert.equal(searchRegistry(registry, { text: 'playerHea', type: 'aob' })[0]?.title, 'playerHealth');
    assert.equal(searchRegistry(registry, { text: 'ZZ', type: 'script' }).length, 1);
  });

  test('filters by module, value type, source, scan type, warnings, and result type', async () => {
    const { registry } = await makeRegistry();

    assert.equal(searchRegistry(registry, { module: 'Avowed-Win64-Shipping.exe' }).length, 3);
    assert.equal(searchRegistry(registry, { type: 'pointer', valueType: 'float' })[0]?.title, 'Player Health');
    assert.equal(searchRegistry(registry, { type: 'aob', source: 'Health Script' }).length, 2);
    assert.equal(searchRegistry(registry, { type: 'aob', scanType: 'aobscanmodule' }).length, 2);
    assert.equal(searchRegistry(registry, { type: 'aob', scanType: 'aobscan' }).length, 1);
    assert.equal(searchRegistry(registry, { type: 'aob', warnings: true })[0]?.title, 'badSig');
  });

  test('searches normalized AOB patterns and module-less scans', async () => {
    const { registry } = await makeRegistry();

    assert.equal(searchRegistry(registry, { type: 'aob', pattern: '48 8B ?? *' })[0]?.title, 'playerHealth');
    const moduleless = searchRegistry(registry, { type: 'aob', text: 'globalEssence' })[0];
    assert.equal(moduleless?.module, null);
    assert.match(moduleless?.warnings.join('\n') ?? '', /does not declare a module/);
  });

  test('filters rejected entries and resolves entries by id with source linkage', async () => {
    const { registry } = await makeRegistry();

    const rejection = searchRegistry(registry, { type: 'rejection', text: 'Malformed Script' })[0];
    assert.equal(rejection?.source.sourceEntryDescription, 'Malformed Script');

    const aob = searchRegistry(registry, { type: 'aob', text: 'playerHealth' })[0];
    assert.ok(aob);
    assert.equal(getRegistryEntry(registry, aob!.id)?.source.sourceEntryDescription, 'Health Script');
    assert.equal(getRegistryEntry(registry, 'missing-id'), null);
  });

  test('returns deterministic ordering and does not mutate the loaded registry', async () => {
    const { registry } = await makeRegistry();
    const before = JSON.stringify(registry);
    const first = searchRegistry(registry, { text: 'health' }).map((result) => result.id);
    const second = searchRegistry(registry, { text: 'health' }).map((result) => result.id);

    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(registry), before);
  });

  test('reports missing files, invalid JSON, and unsupported schema versions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-registry-query-'));
    const invalidJson = path.join(dir, 'invalid.json');
    const unsupported = path.join(dir, 'unsupported.json');
    fs.writeFileSync(invalidJson, '{ nope', 'utf8');
    fs.writeFileSync(unsupported, JSON.stringify({ schemaVersion: '99.0.0' }), 'utf8');

    await assert.rejects(() => loadRegistry(path.join(dir, 'missing.json')), /could not be read/);
    await assert.rejects(() => loadRegistry(invalidJson), /not valid JSON/);
    await assert.rejects(() => loadRegistry(unsupported), /Unsupported registry schema version/);
  });
});

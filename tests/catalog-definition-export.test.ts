import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import { exportCatalogDefinitionToYaml } from '../src/core/definitions/export-catalog-definition.ts';
import { importDefinitionCt } from '../src/core/definitions/import-definition-ct.ts';
import { compileYamlToDefinition } from '../src/core/definitions/compile-yaml.v1.ts';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"Export Test Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"Game.exe"+1A2B3C</Address>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

describe('catalog definition export', () => {
  before(async () => {
    await initDatabase();
  });

  test('round-trips CT import → YAML export → compile', async () => {
    const gameId = `export-roundtrip-${Date.now()}`;
    const imported = await importDefinitionCt(SAMPLE_CT, { title: gameId });
    assert.equal(imported.success, true);
    if (!imported.success) return;

    const bundle = exportCatalogDefinitionToYaml(imported.catalogGameId);
    assert.ok(bundle);
    assert.match(bundle!.yaml, /Export Test Health/);
    assert.match(bundle!.yaml, /schemaVersion:/);

    const compiled = compileYamlToDefinition(bundle!.yaml);
    if (!compiled.success) {
      assert.fail(compiled.errors.join('; '));
    }
    assert.equal(compiled.definition.memoryFeatures?.length, 1);
    assert.equal(compiled.definition.safety.verificationStatus, 'community');
  });
});

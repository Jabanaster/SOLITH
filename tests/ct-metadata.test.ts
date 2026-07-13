import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from '../src/core/database/index.ts';
import { parseCheatTableMetadata } from '../src/core/definitions/ct-metadata.ts';
import { importDefinitionCt } from '../src/core/definitions/import-definition-ct.ts';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/community-ct/CrimsonDesert.CT',
);

describe('ct-metadata import', () => {
  before(async () => {
    await initDatabase();
  });

  test('extracts top-level cheats from script-heavy Crimson Desert CT', async () => {
    const xml = fs.readFileSync(fixturePath, 'utf8');
    const metadata = await parseCheatTableMetadata(xml, {
      title: 'Crimson Desert',
      executables: ['CrimsonDesert.exe'],
    });
    assert.ok(metadata.entries.length >= 20);
    assert.ok(metadata.entries.some((e) => /Auto Fill HP/i.test(e.name)));
    assert.ok(metadata.entries.some((e) => /Fast friendship/i.test(e.name)));
    assert.equal(metadata.definition.memoryFeatures?.length, metadata.entries.length);
    assert.ok(metadata.scriptOnlyCount >= 10);
  });

  test('imports metadata when pointer entries are not supported', async () => {
    const xml = fs.readFileSync(fixturePath, 'utf8');
    const result = await importDefinitionCt(xml, { title: 'Crimson Desert' });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.metadataImport, true);
      assert.ok((result.cheatCount ?? 0) >= 20);
      assert.equal(result.acceptedCount, 0);
    }
  });
});

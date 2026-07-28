import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from '../src/core/database/index.ts';
import {
  commitInstallDiscoveryRecords,
  installedGameCount,
  previewInstallDiscoveryScan,
} from '../src/core/install-discovery/index.ts';
import { getDefinitionPayload } from '../src/core/trainer-catalog/store.ts';
import {
  importDefinitionCt,
  previewDefinitionCt,
} from '../src/core/definitions/import-definition-ct.ts';

const SAMPLE_CT = `<?xml version="1.0" encoding="utf-8"?>
<CheatTable>
  <CheatEntries>
    <CheatEntry>
      <Description>"Preview Gate Health"</Description>
      <VariableType>Float</VariableType>
      <Address>"PreviewGame.exe"+1A2B3C</Address>
    </CheatEntry>
    <CheatEntry>
      <Description>"Neutralized Script"</Description>
      <AssemblerScript>[ENABLE]
aobscanmodule(previewHealth, PreviewGame.exe, 48 8B ?? ?? 89)
registersymbol(previewHealth)
[DISABLE]
unregistersymbol(previewHealth)
</AssemblerScript>
    </CheatEntry>
  </CheatEntries>
</CheatTable>`;

describe('trainer library preview gates', () => {
  let tempRoot = '';

  before(async () => {
    await initDatabase();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-preview-gate-'));
  });

  after(() => {
    if (tempRoot && path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('installed game discovery preview does not mutate installed-game records', () => {
    const gameDir = path.join(tempRoot, 'Preview Gate Game');
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'PreviewGame.exe'), 'MZ');

    const beforeCount = installedGameCount();
    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });
    const afterCount = installedGameCount();

    assert.equal(afterCount, beforeCount);
    assert.equal(preview.records.length, 1);
    assert.equal(preview.records[0].installPath, path.resolve(gameDir));
    assert.equal(preview.records[0].unsupportedReason, 'no_catalog_match');

    const committed = commitInstallDiscoveryRecords(preview.records);
    assert.equal(committed.added, 1);

    const duplicatePreview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [tempRoot],
    });
    assert.equal(duplicatePreview.records[0].duplicate, true);
  });

  test('CT preview compiles inert metadata without writing catalog payloads', async () => {
    const title = `preview-gate-${Date.now()}`;
    const preview = await previewDefinitionCt(SAMPLE_CT, { title });

    assert.equal(preview.success, true);
    if (!preview.success) return;
    assert.equal(preview.acceptedCount, 1);
    assert.equal(preview.scriptAnalysisCount, 1);
    assert.equal(getDefinitionPayload(preview.catalogGameId), null);

    const imported = await importDefinitionCt(SAMPLE_CT, { title });
    assert.equal(imported.success, true);
    if (!imported.success) return;
    assert.ok(getDefinitionPayload(imported.catalogGameId));
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from '../src/core/database/index.ts';
import {
  commitInstallDiscoveryRecords,
  installedGameCount,
  listInstalledGamesWithCatalog,
  previewInstallDiscoveryScan,
  runInstallDiscoveryScan,
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
    fs.mkdirSync(path.join(gameDir, 'Content', 'Paks'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'Content', 'Paks', 'PreviewGame.pak'), 'pak');

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

  test('legacy scan, repeat preview, cancellation, selective commit, duplicates, failures, and revalidation stay controlled', () => {
    const root = path.join(tempRoot, 'controlled-discovery');
    const names = ['Alpha Game', 'Beta Game', 'Gamma Game'];
    for (const name of names) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${name.replace(/\s/g, '')}.exe`), 'MZ');
      fs.mkdirSync(path.join(dir, 'Content', 'Paks'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'Content', 'Paks', 'Game.pak'), 'pak');
    }
    const malformedGog = path.join(tempRoot, 'malformed-gog.json');
    fs.writeFileSync(malformedGog, '{not-json');
    const missingRoot = path.join(tempRoot, 'inaccessible-missing-root');
    const options = {
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      gogFixturePath: malformedGog,
      userSelectedRoots: [root, missingRoot],
    };

    const beforeCount = installedGameCount();
    const legacy = runInstallDiscoveryScan(options);
    assert.equal(legacy.records.length, 3);
    assert.equal(installedGameCount(), beforeCount, 'legacy route must not persist');
    assert.ok(legacy.failures.some((failure) => failure.location === malformedGog));
    assert.ok(legacy.failures.some((failure) => failure.location === path.resolve(missingRoot)));

    const repeated = runInstallDiscoveryScan(options);
    assert.deepEqual(
      repeated.records.map((record) => record.installPath).sort(),
      legacy.records.map((record) => record.installPath).sort(),
    );
    assert.equal(installedGameCount(), beforeCount, 'repeated preview and cancellation must not persist');

    const selected = legacy.records.find((record) => record.displayName === 'Beta Game');
    assert.ok(selected);
    const committed = commitInstallDiscoveryRecords([selected]);
    assert.deepEqual(committed, { added: 1, skipped: 0, rejected: 0 });
    assert.equal(installedGameCount(), beforeCount + 1);
    assert.equal(listInstalledGamesWithCatalog().some((record) => record.installPath === selected.installPath), true);

    const duplicatePreview = runInstallDiscoveryScan(options);
    const duplicate = duplicatePreview.records.find((record) => record.installPath === selected.installPath);
    assert.equal(duplicate?.duplicate, true);
    const newRecord = duplicatePreview.records.find((record) => record.displayName === 'Gamma Game');
    assert.ok(newRecord);
    const duplicateCommit = commitInstallDiscoveryRecords([duplicate!, newRecord]);
    assert.deepEqual(duplicateCommit, { added: 1, skipped: 1, rejected: 0 });

    const forged = { ...newRecord, id: 'forged', installPath: path.join(tempRoot, 'does-not-exist') };
    const rejected = commitInstallDiscoveryRecords([forged]);
    assert.deepEqual(rejected, { added: 0, skipped: 0, rejected: 1 });
  });

  test('shared runtimes and redistributables appear only in rejected diagnostics', () => {
    const steamRoot = path.join(tempRoot, 'steam-runtime-fixture');
    const steamapps = path.join(steamRoot, 'steamapps');
    const runtimeDir = path.join(steamapps, 'common', 'Steamworks Shared');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, 'SteamworksCommonRedist.exe'), 'MZ');
    fs.writeFileSync(
      path.join(steamapps, 'appmanifest_228980.acf'),
      `"AppState"\n{\n"appid" "228980"\n"name" "Steamworks Common Redistributables"\n"installdir" "Steamworks Shared"\n}`,
    );

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: steamRoot,
    });

    assert.equal(preview.records.some((record) => /steamworks/i.test(record.displayName ?? '')), false);
    assert.ok(preview.rejected.some((record) =>
      record.reason === 'shared_runtime_or_redistributable'
      && /steamworks/i.test(`${record.displayName} ${record.installPath}`),
    ));
    assert.equal(preview.discovered, 0);
  });

  test('tools and arbitrary executables are rejected while packaged unknown games remain uncertain', () => {
    const root = path.join(tempRoot, 'weighted-classification');
    const rejectedFixtures = [
      ['Antigravity IDE', 'Antigravity.exe'],
      ['Git', 'git.exe'],
      ['Playnite', 'Playnite.DesktopApp.exe'],
      ['RealityScan', 'RealityScan.exe'],
      ['Wallpapers', 'WallpaperApp.exe'],
      ['Narrative Navigator', 'NarrativeNavigator.exe'],
      ['Grid Inventory', 'GridInventory.exe'],
      ['Convai AI Plugin', 'ConvaiPlugin.exe'],
    ];
    for (const [folder, executable] of rejectedFixtures) {
      const fixture = path.join(root, folder);
      fs.mkdirSync(fixture, { recursive: true });
      fs.writeFileSync(path.join(fixture, executable), 'MZ');
    }

    const arbitrary = path.join(root, 'Ordinary Application');
    fs.mkdirSync(arbitrary, { recursive: true });
    fs.writeFileSync(path.join(arbitrary, 'program.exe'), 'MZ');

    const unityGame = path.join(root, 'Unknown Unity Game');
    fs.mkdirSync(path.join(unityGame, 'UnknownUnityGame_Data'), { recursive: true });
    fs.writeFileSync(path.join(unityGame, 'UnknownUnityGame.exe'), 'MZ');

    const unrealGame = path.join(root, 'Unknown Packaged Game');
    fs.mkdirSync(path.join(unrealGame, 'Content', 'Paks'), { recursive: true });
    fs.writeFileSync(path.join(unrealGame, 'UnknownPackagedGame.exe'), 'MZ');
    fs.writeFileSync(path.join(unrealGame, 'Content', 'Paks', 'UnknownPackagedGame.pak'), 'pak');

    const preview = previewInstallDiscoveryScan({
      offlineRootsOnly: true,
      steamInstallPath: path.join(tempRoot, 'missing-steam'),
      userSelectedRoots: [root],
    });

    assert.deepEqual(
      preview.records.map((record) => record.displayName).sort(),
      ['Unknown Packaged Game', 'Unknown Unity Game'],
    );
    assert.ok(preview.records.every((record) => record.classification === 'uncertain'));
    assert.ok(preview.records.every((record) => record.classificationReason.startsWith('weighted_game_evidence:')));
    for (const [folder] of rejectedFixtures) {
      assert.ok(preview.rejected.some((record) =>
        record.displayName === folder || path.basename(record.installPath) === folder,
      ));
    }
    assert.ok(preview.rejected.some((record) =>
      record.displayName === 'Ordinary Application'
      && record.reason === 'insufficient_game_evidence',
    ));
    assert.equal(preview.discovered, 2);
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

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  copyDirectoryContents,
  findAvowedWingdkPackageDir,
  isAvowedAttachExecutable,
  isAvowedWingdkExecutable,
  resolveAvowedAlabamaConfigDir,
  resolveAvowedWingdkBackupRoots,
  resolveAvowedWingdkWgsDir,
  snapshotAvowedAlabamaConfig,
  snapshotAvowedWingdkSaves,
} from '../../src/core/backups/avowed-wingdk.js';

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avowed-wingdk-'));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('executable helpers recognize Steam and WinGDK names', () => {
  assert.equal(isAvowedWingdkExecutable('Avowed-WinGDK-Shipping.exe'), true);
  assert.equal(isAvowedWingdkExecutable('Avowed.exe'), false);
  assert.equal(isAvowedAttachExecutable('Avowed.exe'), true);
  assert.equal(isAvowedAttachExecutable('Avowed-WinGDK-Shipping.exe'), true);
  assert.equal(isAvowedAttachExecutable('Other.exe'), false);
});

test('fuzzy-matches Microsoft.Avowed* package and prefers wgs-bearing dir', () => {
  const packages = path.join(tempRoot, 'Packages');
  const withoutWgs = path.join(packages, 'Microsoft.Avowed_oldsuffix');
  const withWgs = path.join(packages, 'Microsoft.Avowed_8wekyb3d8bbwe');
  fs.mkdirSync(path.join(withoutWgs, 'SystemAppData'), { recursive: true });
  fs.mkdirSync(path.join(withWgs, 'SystemAppData', 'wgs', 'container'), { recursive: true });
  fs.writeFileSync(path.join(withWgs, 'SystemAppData', 'wgs', 'container', 'save.bin'), 'save');

  const found = findAvowedWingdkPackageDir(tempRoot);
  assert.equal(found, withWgs);
  assert.equal(resolveAvowedWingdkWgsDir(tempRoot), path.join(withWgs, 'SystemAppData', 'wgs'));
});

test('resolves Alabama WinGDK config directory', () => {
  const configDir = path.join(tempRoot, 'Alabama', 'Saved', 'Config', 'WinGDK');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'GameUserSettings.ini'), '[/Script/Engine.GameUserSettings]\n');

  assert.equal(resolveAvowedAlabamaConfigDir(tempRoot), configDir);
});

test('copyDirectoryContents is read-from-source write-to-dest only', () => {
  const src = path.join(tempRoot, 'src');
  const dest = path.join(tempRoot, 'dest');
  fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(src, 'nested', 'b.txt'), 'beta');

  const count = copyDirectoryContents(src, dest);
  assert.equal(count, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8'), 'alpha');
  assert.equal(fs.readFileSync(path.join(dest, 'nested', 'b.txt'), 'utf8'), 'beta');
  // Source untouched
  assert.equal(fs.readFileSync(path.join(src, 'a.txt'), 'utf8'), 'alpha');
});

test('save snapshot copies wgs into userData/backups/avowed-wingdk/saves', () => {
  const pkg = path.join(tempRoot, 'Packages', 'Microsoft.Avowed_test');
  const wgs = path.join(pkg, 'SystemAppData', 'wgs');
  fs.mkdirSync(wgs, { recursive: true });
  fs.writeFileSync(path.join(wgs, 'slot.dat'), 'wingdk-save');

  const userData = path.join(tempRoot, 'SolithUserData');
  const result = snapshotAvowedWingdkSaves({
    userDataRoot: userData,
    localAppData: tempRoot,
    label: 'test-autosave',
  });

  assert.equal(result.success, true);
  assert.equal(result.filesCopied, 1);
  const roots = resolveAvowedWingdkBackupRoots(userData);
  assert.ok(result.destDir?.startsWith(roots.saves));
  assert.equal(fs.readFileSync(path.join(result.destDir!, 'slot.dat'), 'utf8'), 'wingdk-save');
  // Never wrote into game package
  assert.equal(fs.readFileSync(path.join(wgs, 'slot.dat'), 'utf8'), 'wingdk-save');
  assert.deepEqual(fs.readdirSync(wgs), ['slot.dat']);
});

test('config launch snapshot copies Alabama WinGDK ini into backups/config', () => {
  const configDir = path.join(tempRoot, 'Alabama', 'Saved', 'Config', 'WinGDK');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'GameUserSettings.ini'), 'FullscreenMode=1\n');

  const userData = path.join(tempRoot, 'SolithUserData');
  const result = snapshotAvowedAlabamaConfig({
    userDataRoot: userData,
    localAppData: tempRoot,
    label: 'test-launch',
  });

  assert.equal(result.success, true);
  assert.equal(result.filesCopied, 1);
  assert.ok(result.destDir?.includes(`${path.sep}config${path.sep}`));
  assert.equal(
    fs.readFileSync(path.join(result.destDir!, 'GameUserSettings.ini'), 'utf8'),
    'FullscreenMode=1\n',
  );
});

test('snapshots skip cleanly when WinGDK paths are absent', () => {
  const userData = path.join(tempRoot, 'SolithUserData');
  const saves = snapshotAvowedWingdkSaves({ userDataRoot: userData, localAppData: tempRoot });
  const config = snapshotAvowedAlabamaConfig({ userDataRoot: userData, localAppData: tempRoot });
  assert.equal(saves.skipped, true);
  assert.equal(saves.reason, 'wgs_not_found');
  assert.equal(config.skipped, true);
  assert.equal(config.reason, 'config_not_found');
});

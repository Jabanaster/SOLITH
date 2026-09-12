import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanBattleNetInstalls } from '../src/core/install-discovery/battle-net.ts';

const BLIZZARD_UNINSTALLER = 'C:\\ProgramData\\Battle.net\\Agent\\Blizzard Uninstaller.exe';

function makeBattleNetFixture(): {
  fixturePath: string;
  root: string;
  validGame: string;
  validExe: string;
  stalePath: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-battlenet-fixture-'));

  // Valid install evidence: real folder + real executable, shaped exactly
  // like a genuine Blizzard "Programs and Features" Uninstall subkey
  // (DisplayIcon -> real exe, corroborating UninstallString + Publisher).
  const validGame = path.join(root, 'StarCraft II');
  fs.mkdirSync(validGame, { recursive: true });
  const validExe = path.join(validGame, 'SC2.exe');
  fs.writeFileSync(validExe, '');

  // A non-Battle.net entry that superficially resembles one: display name
  // mentions a Blizzard-style title and even points at a real exe, but
  // carries neither the shared Blizzard uninstaller path nor the
  // "Blizzard Entertainment" publisher string — must be excluded.
  const lookalikeGame = path.join(root, 'World of Somecraft');
  fs.mkdirSync(lookalikeGame, { recursive: true });
  const lookalikeExe = path.join(lookalikeGame, 'Somecraft.exe');
  fs.writeFileSync(lookalikeExe, '');

  // Missing/stale path: registry-shaped entry with real Blizzard markers,
  // but the install folder/executable no longer exists on disk.
  const stalePath = path.join(root, 'Uninstalled Diablo IV', 'Diablo IV.exe');

  const fixturePath = path.join(root, 'battle-net-uninstall-entries.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        displayName: 'StarCraft II',
        publisher: 'Blizzard Entertainment',
        uninstallString: BLIZZARD_UNINSTALLER,
        displayIcon: validExe,
      },
      {
        displayName: 'World of Somecraft',
        publisher: 'Totally Legit Games Inc.',
        uninstallString: 'C:\\Program Files\\World of Somecraft\\uninst.exe',
        displayIcon: lookalikeExe,
      },
      {
        displayName: 'Diablo IV',
        publisher: 'Blizzard Entertainment',
        uninstallString: BLIZZARD_UNINSTALLER,
        displayIcon: stalePath,
      },
      // Malformed/partial registry data: no DisplayIcon, no InstallLocation,
      // and no Blizzard-specific corroboration at all — nothing to resolve.
      {
        displayName: 'Some Random Product',
      },
    ]),
  );

  return { root, fixturePath, validGame, validExe, stalePath };
}

describe('install-discovery battle.net scan', () => {
  const fixture = makeBattleNetFixture();

  after(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('discovers a game from valid Uninstall-registry-shaped evidence', () => {
    const games = scanBattleNetInstalls({ battleNetFixturePath: fixture.fixturePath });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'battlenet');
    assert.equal(games[0].displayName, 'StarCraft II');
    assert.equal(games[0].launcherAppId, 'battlenet:StarCraft II');
    assert.ok(games[0].installPath.toLowerCase().includes('starcraft ii'));
    assert.ok(games[0].executablePath?.endsWith('SC2.exe'));
  });

  test('excludes a non-Battle.net entry that superficially resembles one', () => {
    const games = scanBattleNetInstalls({ battleNetFixturePath: fixture.fixturePath });
    assert.ok(!games.some((g) => g.displayName === 'World of Somecraft'));
  });

  test('excludes an entry whose install evidence is missing or stale', () => {
    const games = scanBattleNetInstalls({ battleNetFixturePath: fixture.fixturePath });
    assert.ok(!games.some((g) => g.displayName === 'Diablo IV'));
  });

  test('excludes malformed/partial registry data with no resolvable path', () => {
    const games = scanBattleNetInstalls({ battleNetFixturePath: fixture.fixturePath });
    assert.ok(!games.some((g) => g.displayName === 'Some Random Product'));
  });

  test('returns empty when fixture missing', () => {
    const games = scanBattleNetInstalls({
      battleNetFixturePath: path.join(os.tmpdir(), `solith-no-battlenet-${Date.now()}.json`),
    });
    assert.equal(games.length, 0);
  });
});

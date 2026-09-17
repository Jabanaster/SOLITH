import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanXboxInstallsFromFixture } from '../src/core/install-discovery/xbox.ts';
import { createInstallIdentity } from '../src/core/install-discovery/identity.ts';

const APPXMANIFEST_TEMPLATE = (identityName: string, displayName: string, executable: string) => `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="${identityName}" Publisher="CN=TEST-PUBLISHER" Version="1.0.0.0" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${displayName}</DisplayName>
  </Properties>
  <Applications>
    <Application Id="Game" Executable="${executable}" EntryPoint="Windows.FullTrustApplication" />
  </Applications>
</Package>`;

const GAME_CONFIG_TEMPLATE = (storeId: string, titleId: string, displayName: string, executable: string) => `<?xml version="1.0" ?>
<Game configVersion="1">
  <Identity Name="Test.Identity" Publisher="CN=TEST-PUBLISHER" Version="1.0.0.0"/>
  <ShellVisuals DefaultDisplayName="${displayName}" />
  <StoreId>${storeId}</StoreId>
  <TitleId>${titleId}</TitleId>
  <ExecutableList>
    <Executable Name="${executable}" TargetDeviceFamily="PC" Id="Game"/>
  </ExecutableList>
</Game>`;

interface FixturePackage {
  root: string;
  contentRoot: string;
  installLocation: string;
}

function makeXboxContentRoot(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `solith-xbox-fixture-${name}-`));
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Atomfall-shaped: manifest/config declare a Launcher/ stub as "the" executable; real engine binary sits in bin/. */
function makeLauncherPlusGameFixture(): FixturePackage {
  const contentRoot = makeXboxContentRoot('launcher-plus-game');
  fs.mkdirSync(path.join(contentRoot, 'Launcher'), { recursive: true });
  fs.mkdirSync(path.join(contentRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(contentRoot, 'Launcher', 'TestGame.exe'), '');
  fs.writeFileSync(path.join(contentRoot, 'bin', 'TestGame_dx12.exe'), '');
  fs.writeFileSync(
    path.join(contentRoot, 'appxmanifest.xml'),
    APPXMANIFEST_TEMPLATE('Publisher.TestGame', 'Test Game', 'Launcher\\TestGame.exe'),
  );
  fs.writeFileSync(
    path.join(contentRoot, 'MicrosoftGame.config'),
    GAME_CONFIG_TEMPLATE('STORE123', 'TITLE456', 'Test Game', 'Launcher/TestGame.exe'),
  );
  return { root: contentRoot, contentRoot, installLocation: contentRoot };
}

/** Generic single-executable Xbox title — no Launcher/ indirection at all. */
function makeSingleExecutableFixture(): FixturePackage {
  const contentRoot = makeXboxContentRoot('single-exe');
  fs.writeFileSync(path.join(contentRoot, 'SoloGame.exe'), '');
  fs.writeFileSync(
    path.join(contentRoot, 'appxmanifest.xml'),
    APPXMANIFEST_TEMPLATE('Publisher.SoloGame', 'Solo Game', 'SoloGame.exe'),
  );
  fs.writeFileSync(
    path.join(contentRoot, 'MicrosoftGame.config'),
    GAME_CONFIG_TEMPLATE('STORE789', 'TITLE012', 'Solo Game', 'SoloGame.exe'),
  );
  return { root: contentRoot, contentRoot, installLocation: contentRoot };
}

function makeMissingMetadataFixture(): FixturePackage {
  const contentRoot = makeXboxContentRoot('missing-metadata');
  fs.writeFileSync(path.join(contentRoot, 'SomeApp.exe'), '');
  // No MicrosoftGame.config at all — not a Microsoft GDK game package.
  return { root: contentRoot, contentRoot, installLocation: contentRoot };
}

function makeMalformedMetadataFixture(): FixturePackage {
  const contentRoot = makeXboxContentRoot('malformed-metadata');
  fs.writeFileSync(path.join(contentRoot, 'BrokenGame.exe'), '');
  fs.writeFileSync(path.join(contentRoot, 'MicrosoftGame.config'), 'not even xml { garbage <<<');
  return { root: contentRoot, contentRoot, installLocation: contentRoot };
}

function makeMissingExecutableFixture(): FixturePackage {
  const contentRoot = makeXboxContentRoot('missing-exe');
  fs.writeFileSync(
    path.join(contentRoot, 'appxmanifest.xml'),
    APPXMANIFEST_TEMPLATE('Publisher.GhostGame', 'Ghost Game', 'GhostGame.exe'),
  );
  fs.writeFileSync(
    path.join(contentRoot, 'MicrosoftGame.config'),
    GAME_CONFIG_TEMPLATE('STOREGHOST', 'TITLEGHOST', 'Ghost Game', 'GhostGame.exe'),
  );
  // Declared executable never actually written to disk.
  return { root: contentRoot, contentRoot, installLocation: contentRoot };
}

function writeFixtureManifest(root: string, packages: Array<Record<string, string>>): string {
  const fixturePath = path.join(root, 'xbox-packages.json');
  fs.writeFileSync(fixturePath, JSON.stringify(packages));
  return fixturePath;
}

describe('install-discovery xbox scan', () => {
  const cleanupRoots: string[] = [];
  after(() => {
    for (const root of cleanupRoots) fs.rmSync(root, { recursive: true, force: true });
  });

  test('resolves the real engine binary, not the Launcher/ bootstrap stub', () => {
    const fixture = makeLauncherPlusGameFixture();
    cleanupRoots.push(fixture.root);
    const fixturePath = writeFixtureManifest(fixture.root, [
      {
        name: 'Test.Game',
        packageFamilyName: 'Publisher.TestGame_abc123',
        packageFullName: 'Publisher.TestGame_1.0.0.0_x64__abc123',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: fixture.installLocation,
      },
    ]);

    const games = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(games.length, 1);
    const game = games[0];
    assert.equal(game.platform, 'xbox');
    assert.equal(game.displayName, 'Test Game');
    assert.equal(game.launcherAppId, 'xbox:Publisher.TestGame_abc123');
    assert.ok(game.executablePath, 'primary executable should resolve');
    assert.ok(game.executablePath!.replace(/\\/g, '/').endsWith('bin/TestGame_dx12.exe'));
    assert.ok(!path.relative(fixture.contentRoot, game.executablePath!).toLowerCase().includes('launcher'));
  });

  test('resolves a genuine single-executable title with no Launcher/ indirection', () => {
    const fixture = makeSingleExecutableFixture();
    cleanupRoots.push(fixture.root);
    const fixturePath = writeFixtureManifest(fixture.root, [
      {
        name: 'Solo.Game',
        packageFamilyName: 'Publisher.SoloGame_def456',
        packageFullName: 'Publisher.SoloGame_1.0.0.0_x64__def456',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: fixture.installLocation,
      },
    ]);

    const games = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(games.length, 1);
    assert.ok(games[0].executablePath!.replace(/\\/g, '/').endsWith('SoloGame.exe'));
  });

  test('rejects a package with no MicrosoftGame.config (not a GDK game)', () => {
    const fixture = makeMissingMetadataFixture();
    cleanupRoots.push(fixture.root);
    const fixturePath = writeFixtureManifest(fixture.root, [
      {
        name: 'Some.App',
        packageFamilyName: 'Publisher.SomeApp_ghi789',
        packageFullName: 'Publisher.SomeApp_1.0.0.0_x64__ghi789',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: fixture.installLocation,
      },
    ]);

    const games = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(games.length, 0);
  });

  test('rejects malformed MicrosoftGame.config rather than crashing', () => {
    const fixture = makeMalformedMetadataFixture();
    cleanupRoots.push(fixture.root);
    const fixturePath = writeFixtureManifest(fixture.root, [
      {
        name: 'Broken.Game',
        packageFamilyName: 'Publisher.BrokenGame_jkl012',
        packageFullName: 'Publisher.BrokenGame_1.0.0.0_x64__jkl012',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: fixture.installLocation,
      },
    ]);

    const games = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(games.length, 0);
  });

  test('leaves executablePath unresolved when the declared executable does not exist on disk', () => {
    const fixture = makeMissingExecutableFixture();
    cleanupRoots.push(fixture.root);
    const fixturePath = writeFixtureManifest(fixture.root, [
      {
        name: 'Ghost.Game',
        packageFamilyName: 'Publisher.GhostGame_mno345',
        packageFullName: 'Publisher.GhostGame_1.0.0.0_x64__mno345',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: fixture.installLocation,
      },
    ]);

    const games = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(games.length, 1);
    assert.equal(games[0].executablePath, undefined);
  });

  test('ignores a stale package registration whose install location no longer exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-xbox-fixture-stale-'));
    cleanupRoots.push(root);
    const goneLocation = path.join(root, 'does-not-exist-anymore');
    const fixturePath = writeFixtureManifest(root, [
      {
        name: 'Stale.Game',
        packageFamilyName: 'Publisher.StaleGame_pqr678',
        packageFullName: 'Publisher.StaleGame_1.0.0.0_x64__pqr678',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: goneLocation,
      },
    ]);

    const games = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(games.length, 0);
  });

  test('returns empty when fixture file itself is missing', () => {
    const games = scanXboxInstallsFromFixture(path.join(os.tmpdir(), `solith-no-xbox-${Date.now()}.json`));
    assert.equal(games.length, 0);
  });

  test('duplicate scans of the same install produce the same install identity (idempotent resync)', () => {
    const fixture = makeLauncherPlusGameFixture();
    cleanupRoots.push(fixture.root);
    const fixturePath = writeFixtureManifest(fixture.root, [
      {
        name: 'Test.Game',
        packageFamilyName: 'Publisher.TestGame_abc123',
        packageFullName: 'Publisher.TestGame_1.0.0.0_x64__abc123',
        publisher: 'CN=TEST-PUBLISHER',
        version: '1.0.0.0',
        installLocation: fixture.installLocation,
      },
    ]);

    const first = scanXboxInstallsFromFixture(fixturePath);
    const second = scanXboxInstallsFromFixture(fixturePath);
    assert.equal(createInstallIdentity(first[0]).installIdentity, createInstallIdentity(second[0]).installIdentity);
  });
});

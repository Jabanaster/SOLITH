import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanUbisoftInstalls } from '../src/core/install-discovery/ubisoft.ts';
import { scanEaInstalls } from '../src/core/install-discovery/ea.ts';
import { scanXboxInstalls } from '../src/core/install-discovery/xbox.ts';

function makeUbisoftFixture(): { fixturePath: string; game: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ubisoft-fixture-'));
  const game = path.join(root, 'ubisoft-game');
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'DemoGame.exe'), '');
  const fixturePath = path.join(root, 'ubisoft-installs.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        gameId: '1771',
        installDir: game,
        displayName: 'Ubisoft Demo Game',
      },
    ]),
  );
  return { root, game, fixturePath };
}

function makeEaFixture(): { fixturePath: string; game: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-fixture-'));
  const game = path.join(root, 'ea-game');
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'EaDemo.exe'), '');
  const fixturePath = path.join(root, 'ea-installs.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        offerId: 'OFB-EAST:987654321',
        installDir: game,
        displayName: 'EA Demo Game',
      },
    ]),
  );
  return { root, game, fixturePath };
}

/** A minimal but real-shaped AppxManifest.xml with an optional gaming-corroboration signal. */
function appxManifestXml(options: { identityName: string; withGamingDependency?: boolean; withGamingCapability?: boolean }): string {
  const dependency = options.withGamingDependency
    ? `    <PackageDependency Name="Microsoft.GamingServices" MinVersion="1.0.0.0" Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" />\n`
    : '';
  const capability = options.withGamingCapability
    ? `    <DeviceCapability Name="gamingDeviceInformation" />\n`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="${options.identityName}" Version="1.0.0.0" Publisher="CN=Test Publisher" />
  <Dependencies>
${dependency}  </Dependencies>
  <Capabilities>
${capability}  </Capabilities>
  <Applications>
    <Application Id="App" Executable="App.exe" EntryPoint="Windows.FullTrustApplication" />
  </Applications>
</Package>
`;
}

function makePackageDir(
  root: string,
  dirName: string,
  exeName: string,
  manifestOptions?: { identityName: string; withGamingDependency?: boolean; withGamingCapability?: boolean },
): string {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, exeName), '');
  if (manifestOptions) {
    fs.writeFileSync(path.join(dir, 'AppxManifest.xml'), appxManifestXml(manifestOptions));
  }
  return dir;
}

function makeXboxFixture(): {
  fixturePath: string;
  game: string;
  framework: string;
  calculator: string;
  photos: string;
  genericRuntime: string;
  realGame: string;
  root: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-xbox-fixture-'));

  // Legacy fixture entries (kept for the pre-existing "filters known framework
  // packages" test): a game with gaming-corroboration and a blacklisted framework.
  const game = makePackageDir(root, 'xbox-game', 'XboxDemo.exe', {
    identityName: 'Publisher.XboxDemoGame',
    withGamingDependency: true,
  });
  const framework = makePackageDir(root, 'xbox-framework', 'Framework.dll');

  // Hostile fixtures proving the blacklist-only approach is fixed:
  // packages NOT on any hardcoded blacklist must still be rejected without
  // a corroborating gaming signal in their manifest.
  const calculator = makePackageDir(root, 'calculator-app', 'Calculator.exe', {
    identityName: 'Contoso.Calculator',
  });
  const photos = makePackageDir(root, 'photos-app', 'Photos.exe', {
    identityName: 'Contoso.PhotosViewer',
  });
  const genericRuntime = makePackageDir(root, 'generic-runtime', 'Runtime.exe', {
    identityName: 'Contoso.SomeCodecRuntime',
  });

  // A real-shaped Xbox game AppX, not on the blacklist, with corroborating
  // Gaming Services dependency — must still be detected as plausible.
  const realGame = makePackageDir(root, 'real-xbox-game', 'RealGame.exe', {
    identityName: 'StudioName.RealXboxGame',
    withGamingDependency: true,
  });

  const fixturePath = path.join(root, 'xbox-packages.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        packageFullName: 'Publisher.XboxDemoGame_1.0.0.0_x64__abcdefg12345',
        installDir: game,
        displayName: 'Xbox Demo Game',
      },
      {
        packageFullName: 'Microsoft.VCLibs.140.00_14.0.0.0_x64__8wekyb3d8bbwe',
        installDir: framework,
      },
      {
        packageFullName: 'Contoso.Calculator_1.0.0.0_x64__8wekyb3d8bbwe',
        installDir: calculator,
        displayName: 'Calculator',
      },
      {
        packageFullName: 'Contoso.PhotosViewer_1.0.0.0_x64__8wekyb3d8bbwe',
        installDir: photos,
        displayName: 'Photos',
      },
      {
        packageFullName: 'Contoso.SomeCodecRuntime_1.0.0.0_x64__8wekyb3d8bbwe',
        installDir: genericRuntime,
        displayName: 'Some Codec Runtime',
      },
      {
        packageFullName: 'StudioName.RealXboxGame_1.0.0.0_x64__abcdefg12345',
        installDir: realGame,
        displayName: 'Real Xbox Game',
      },
    ]),
  );
  return { root, game, framework, calculator, photos, genericRuntime, realGame, fixturePath };
}

describe('install-discovery ubisoft scan', () => {
  const ubisoft = makeUbisoftFixture();

  after(() => {
    fs.rmSync(ubisoft.root, { recursive: true, force: true });
  });

  test('discovers game from fixture registry-shaped entries', () => {
    const games = scanUbisoftInstalls({ ubisoftFixturePath: ubisoft.fixturePath });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'ubisoft');
    assert.equal(games[0].displayName, 'Ubisoft Demo Game');
    assert.equal(games[0].launcherAppId, 'ubisoft:1771');
    assert.ok(games[0].installPath.toLowerCase().includes('ubisoft-game'));
    assert.ok(games[0].executablePath?.endsWith('DemoGame.exe'));
  });

  test('returns empty when fixture missing', () => {
    const games = scanUbisoftInstalls({
      ubisoftFixturePath: path.join(os.tmpdir(), `solith-no-ubisoft-${Date.now()}.json`),
    });
    assert.equal(games.length, 0);
  });
});

describe('install-discovery ea scan', () => {
  const ea = makeEaFixture();

  after(() => {
    fs.rmSync(ea.root, { recursive: true, force: true });
  });

  test('discovers game from fixture registry-shaped entries (classic Origin key)', () => {
    const games = scanEaInstalls({ eaFixturePath: ea.fixturePath });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'ea');
    assert.equal(games[0].displayName, 'EA Demo Game');
    assert.equal(games[0].launcherAppId, 'ea:OFB-EAST:987654321');
    assert.ok(games[0].installPath.toLowerCase().includes('ea-game'));
    assert.ok(games[0].executablePath?.endsWith('EaDemo.exe'));
  });

  test('returns empty when fixture missing', () => {
    const games = scanEaInstalls({
      eaFixturePath: path.join(os.tmpdir(), `solith-no-ea-${Date.now()}.json`),
    });
    assert.equal(games.length, 0);
  });

  test('discovers game from fixture-shaped EA Desktop uninstall-registry entry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-desktop-'));
    try {
      const game = path.join(root, 'ea-desktop-game');
      fs.mkdirSync(game, { recursive: true });
      fs.writeFileSync(path.join(game, 'DesktopDemo.exe'), '');
      const fixturePath = path.join(root, 'ea-desktop-installs.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            source: 'ea-desktop',
            uninstallKey: '{11111111-2222-3333-4444-555555555555}',
            publisher: 'Electronic Arts',
            displayName: 'EA Desktop Demo Game',
            installDir: game,
          },
        ]),
      );

      const games = scanEaInstalls({ eaFixturePath: fixturePath });
      assert.equal(games.length, 1);
      assert.equal(games[0].platform, 'ea');
      assert.equal(games[0].displayName, 'EA Desktop Demo Game');
      assert.equal(games[0].launcherAppId, 'ea-desktop:{11111111-2222-3333-4444-555555555555}');
      assert.ok(games[0].installPath.toLowerCase().includes('ea-desktop-game'));
      assert.ok(games[0].executablePath?.endsWith('DesktopDemo.exe'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('excludes a stale EA Desktop entry whose install path no longer exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-stale-'));
    try {
      const missingDir = path.join(root, 'no-longer-here');
      const fixturePath = path.join(root, 'ea-stale.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            source: 'ea-desktop',
            uninstallKey: '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}',
            publisher: 'Electronic Arts',
            displayName: 'EA Stale Game',
            installDir: missingDir,
          },
        ]),
      );

      const games = scanEaInstalls({ eaFixturePath: fixturePath });
      assert.equal(games.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('excludes malformed metadata (non-string install path) without crashing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-malformed-'));
    try {
      const fixturePath = path.join(root, 'ea-malformed.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            source: 'ea-desktop',
            uninstallKey: '{malformed}',
            publisher: 'Electronic Arts',
            displayName: 'EA Malformed Game',
            installDir: 12345,
          },
          null,
          'not-an-object',
        ]),
      );

      const games = scanEaInstalls({ eaFixturePath: fixturePath });
      assert.equal(games.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('excludes non-game registry entries (EA client itself and non-EA publishers)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-nongame-'));
    try {
      const clientDir = path.join(root, 'ea-desktop-client');
      const otherDir = path.join(root, 'other-publisher-app');
      fs.mkdirSync(clientDir, { recursive: true });
      fs.mkdirSync(otherDir, { recursive: true });
      const fixturePath = path.join(root, 'ea-nongame.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            source: 'ea-desktop',
            uninstallKey: '{ea-client}',
            publisher: 'Electronic Arts',
            displayName: 'EA Desktop',
            installDir: clientDir,
          },
          {
            source: 'ea-desktop',
            uninstallKey: '{other-publisher}',
            publisher: 'Some Other Publisher',
            displayName: 'Totally Unrelated App',
            installDir: otherDir,
          },
        ]),
      );

      const games = scanEaInstalls({ eaFixturePath: fixturePath });
      assert.equal(games.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves distinct raw records for the same title seen via two EA sources (duplicate identity)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-dup-'));
    try {
      const game = path.join(root, 'shared-game');
      fs.mkdirSync(game, { recursive: true });
      fs.writeFileSync(path.join(game, 'SharedDemo.exe'), '');
      const fixturePath = path.join(root, 'ea-dup.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            offerId: 'OFB-EAST:111',
            installDir: game,
            displayName: 'Shared Demo Game',
          },
          {
            source: 'ea-desktop',
            uninstallKey: '{shared-demo}',
            publisher: 'Electronic Arts',
            displayName: 'Shared Demo Game',
            installDir: game,
          },
        ]),
      );

      // ea.ts itself does not deduplicate across sources — that is index.ts's
      // job (deduplicateConcreteInstalls / sameConcreteInstall using
      // canonicalInstallPath), which this scanner must not reimplement. Both
      // raw records should come through distinctly with different
      // launcherAppId values so downstream identity resolution can dedupe them.
      const games = scanEaInstalls({ eaFixturePath: fixturePath });
      assert.equal(games.length, 2);
      const launcherAppIds = games.map((g) => g.launcherAppId).sort();
      assert.deepEqual(launcherAppIds, ['ea-desktop:{shared-demo}', 'ea:OFB-EAST:111']);
      assert.ok(games.every((g) => g.installPath.toLowerCase().includes('shared-game')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('degrades gracefully (never throws) on a canonical-mapping-failure-shaped fixture', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ea-broken-'));
    try {
      // Fixture is a JSON object, not an array — the shape scanEaInstallsFromFixture expects.
      const fixturePath = path.join(root, 'ea-broken-shape.json');
      fs.writeFileSync(fixturePath, JSON.stringify({ notAnArray: true }));
      assert.doesNotThrow(() => {
        const games = scanEaInstalls({ eaFixturePath: fixturePath });
        assert.equal(games.length, 0);
      });

      // Fixture is not even valid JSON.
      const brokenJsonPath = path.join(root, 'ea-broken-json.json');
      fs.writeFileSync(brokenJsonPath, '{ this is not valid json');
      assert.doesNotThrow(() => {
        const games = scanEaInstalls({ eaFixturePath: brokenJsonPath });
        assert.equal(games.length, 0);
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('install-discovery xbox scan', () => {
  const xbox = makeXboxFixture();

  after(() => {
    fs.rmSync(xbox.root, { recursive: true, force: true });
  });

  test('discovers game with gaming-corroborated manifest and filters known framework packages', () => {
    const games = scanXboxInstalls({ xboxFixturePath: xbox.fixturePath });
    const demo = games.find((g) => g.launcherAppId === 'xbox:Publisher.XboxDemoGame_1.0.0.0_x64__abcdefg12345');
    assert.ok(demo, 'expected the gaming-corroborated demo package to be detected');
    assert.equal(demo!.platform, 'xbox');
    assert.equal(demo!.displayName, 'Xbox Demo Game');
    assert.ok(demo!.installPath.toLowerCase().includes('xbox-game'));
    assert.ok(demo!.executablePath?.endsWith('XboxDemo.exe'));

    // The blacklisted VCLibs framework package must never appear regardless
    // of manifest contents.
    assert.ok(
      !games.some((g) => g.launcherAppId?.includes('Microsoft.VCLibs')),
      'framework package must be excluded',
    );
  });

  test('rejects a Calculator-style AppX not on the blacklist but lacking gaming corroboration', () => {
    const games = scanXboxInstalls({ xboxFixturePath: xbox.fixturePath });
    assert.ok(
      !games.some((g) => g.launcherAppId?.startsWith('xbox:Contoso.Calculator')),
      'Calculator-style package must be rejected for lack of gaming corroboration',
    );
  });

  test('rejects a Photos-style AppX not on the blacklist but lacking gaming corroboration', () => {
    const games = scanXboxInstalls({ xboxFixturePath: xbox.fixturePath });
    assert.ok(
      !games.some((g) => g.launcherAppId?.startsWith('xbox:Contoso.PhotosViewer')),
      'Photos-style package must be rejected for lack of gaming corroboration',
    );
  });

  test('rejects a generic runtime/framework AppX not on any hardcoded blacklist', () => {
    const games = scanXboxInstalls({ xboxFixturePath: xbox.fixturePath });
    assert.ok(
      !games.some((g) => g.launcherAppId?.startsWith('xbox:Contoso.SomeCodecRuntime')),
      'generic non-game runtime package must be rejected for lack of gaming corroboration',
    );
  });

  test('accepts a real-shaped Xbox game AppX not on the blacklist with gaming-services dependency corroboration', () => {
    const games = scanXboxInstalls({ xboxFixturePath: xbox.fixturePath });
    const real = games.find((g) => g.launcherAppId?.startsWith('xbox:StudioName.RealXboxGame'));
    assert.ok(real, 'real Xbox game package with gaming corroboration must be detected');
    assert.equal(real!.platform, 'xbox');
    assert.equal(real!.displayName, 'Real Xbox Game');
    assert.ok(real!.executablePath?.endsWith('RealGame.exe'));
  });

  test('accepts corroboration via the gamingDeviceInformation capability alone (no dependency)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-xbox-capability-'));
    try {
      const dir = makePackageDir(root, 'capability-game', 'CapGame.exe', {
        identityName: 'StudioName.CapabilityGame',
        withGamingCapability: true,
      });
      const fixturePath = path.join(root, 'packages.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            packageFullName: 'StudioName.CapabilityGame_1.0.0.0_x64__abcdefg12345',
            installDir: dir,
            displayName: 'Capability Game',
          },
        ]),
      );
      const games = scanXboxInstalls({ xboxFixturePath: fixturePath });
      assert.equal(games.length, 1);
      assert.equal(games[0].displayName, 'Capability Game');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a plausible-looking package whose AppxManifest.xml is missing (malformed/incomplete metadata)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-xbox-no-manifest-'));
    try {
      // No manifest file written at all — resolveFromEntry must fail closed.
      const dir = makePackageDir(root, 'no-manifest-app', 'Mystery.exe');
      const fixturePath = path.join(root, 'packages.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            packageFullName: 'Unknown.MysteryApp_1.0.0.0_x64__abcdefg12345',
            installDir: dir,
            displayName: 'Mystery App',
          },
        ]),
      );
      const games = scanXboxInstalls({ xboxFixturePath: fixturePath });
      assert.equal(games.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects a package whose AppxManifest.xml is present but malformed/unreadable-as-gaming', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-xbox-malformed-'));
    try {
      const dir = path.join(root, 'malformed-app');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'App.exe'), '');
      // Malformed/truncated XML with no gaming signal — must not throw and must reject.
      fs.writeFileSync(path.join(dir, 'AppxManifest.xml'), '<Package><Identity Name="Broken"');
      const fixturePath = path.join(root, 'packages.json');
      fs.writeFileSync(
        fixturePath,
        JSON.stringify([
          {
            packageFullName: 'Unknown.MalformedApp_1.0.0.0_x64__abcdefg12345',
            installDir: dir,
            displayName: 'Malformed App',
          },
        ]),
      );
      const games = scanXboxInstalls({ xboxFixturePath: fixturePath });
      assert.equal(games.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns empty when fixture missing', () => {
    const games = scanXboxInstalls({
      xboxFixturePath: path.join(os.tmpdir(), `solith-no-xbox-${Date.now()}.json`),
    });
    assert.equal(games.length, 0);
  });
});

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseVdf, vdfStringValue } from '../src/core/install-discovery/vdf.ts';
import { scanSteamInstalls } from '../src/core/install-discovery/steam.ts';

function makeSteamFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-steam-fixture-'));
  const steamapps = path.join(root, 'steamapps');
  const stardewDir = path.join(steamapps, 'common', 'Stardew Valley');
  fs.mkdirSync(stardewDir, { recursive: true });
  fs.writeFileSync(path.join(stardewDir, 'Stardew Valley.exe'), '');
  fs.writeFileSync(
    path.join(steamapps, 'appmanifest_413150.acf'),
    `"AppState"
{
\t"appid"\t\t"413150"
\t"name"\t\t"Stardew Valley"
\t"installdir"\t\t"Stardew Valley"
}
`,
  );
  // libraryfolders.vdf must reference this temp root with VDF-escaped backslashes.
  const vdfPath = root.replace(/\\/g, '\\\\');
  fs.writeFileSync(
    path.join(steamapps, 'libraryfolders.vdf'),
    `"libraryfolders"
{
	"folders"
	{
		"0"
		{
			"path"		"${vdfPath}"
		}
	}
}
`,
  );
  return root;
}

describe('install-discovery vdf', () => {
  test('parses appmanifest appid and installdir', () => {
    const acf = `"AppState"
{
\t"appid"\t\t"413150"
\t"name"\t\t"Stardew Valley"
\t"installdir"\t\t"Stardew Valley"
}`;
    const parsed = parseVdf(acf) as { AppState: Record<string, unknown> };
    assert.equal(vdfStringValue(parsed.AppState, 'appid'), '413150');
    assert.equal(vdfStringValue(parsed.AppState, 'installdir'), 'Stardew Valley');
  });
});

describe('install-discovery steam scan', () => {
  const steamRoot = makeSteamFixtureRoot();

  after(() => {
    fs.rmSync(steamRoot, { recursive: true, force: true });
  });

  test('discovers Stardew Valley from fixture manifests', () => {
    const games = scanSteamInstalls({ steamInstallPath: steamRoot });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'steam');
    assert.equal(games[0].steamAppId, 413150);
    assert.equal(games[0].displayName, 'Stardew Valley');
    assert.ok(games[0].installPath.toLowerCase().includes('stardew valley'));
    assert.ok(games[0].executablePath?.endsWith('Stardew Valley.exe'));
  });
});

function makePalworldFixtureRoot(): string {
  // Reproduces the real Palworld install shape (Steam appid 1623730,
  // ROADMAP.md Phase 3 curated title): a root-level wrapper stub plus the
  // real Unreal Engine binary nested under Pal/Binaries/Win64/. The
  // previous root-only-existence-check implementation resolved to the
  // wrapper stub here — verified against the real install before this fix.
  //
  // Note: STEAM_EXECUTABLE_LOOKUP's real entry for 1623730 lists only
  // 'Palworld-Win64-Shipping.exe' (not the root wrapper too), so this test
  // exercises the single-known-name nested-resolution fix in steam.ts, NOT
  // the SHIPPING_BINARY_RE tie-break in nested-executable-discovery.ts
  // (that tie-break only engages when 2+ candidates are ALL catalog-known
  // — see "Unreal Engine Shipping binary is preferred..." in
  // tests/install-discovery-nested-executable-discovery.test.ts for that
  // tier's real coverage).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-steam-fixture-palworld-'));
  const steamapps = path.join(root, 'steamapps');
  const installDir = path.join(steamapps, 'common', 'Palworld');
  fs.mkdirSync(path.join(installDir, 'Pal', 'Binaries', 'Win64'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'Palworld.exe'), '');
  fs.writeFileSync(path.join(installDir, 'Pal', 'Binaries', 'Win64', 'Palworld-Win64-Shipping.exe'), '');
  fs.writeFileSync(
    path.join(steamapps, 'appmanifest_1623730.acf'),
    `"AppState"
{
\t"appid"\t\t"1623730"
\t"name"\t\t"Palworld"
\t"installdir"\t\t"Palworld"
}
`,
  );
  const vdfPath = root.replace(/\\/g, '\\\\');
  fs.writeFileSync(
    path.join(steamapps, 'libraryfolders.vdf'),
    `"libraryfolders"
{
	"folders"
	{
		"0"
		{
			"path"		"${vdfPath}"
		}
	}
}
`,
  );
  return root;
}

describe('install-discovery steam scan — nested executable resolution', () => {
  const steamRoot = makePalworldFixtureRoot();

  after(() => {
    fs.rmSync(steamRoot, { recursive: true, force: true });
  });

  test('resolves the nested known executable, not an arbitrary root-level file (regression: previous root-only check + first-.exe fallback)', () => {
    const games = scanSteamInstalls({ steamInstallPath: steamRoot });
    assert.equal(games.length, 1);
    assert.equal(games[0].steamAppId, 1623730);
    assert.ok(
      games[0].executablePath?.replace(/\\/g, '/').endsWith('Pal/Binaries/Win64/Palworld-Win64-Shipping.exe'),
      `expected the nested known binary, got: ${games[0].executablePath}`,
    );
  });
});

function makeBg3FixtureRoot(): string {
  // Reproduces the real Baldur's Gate 3 install shape (Steam appid 1086940,
  // ROADMAP.md Phase 3 curated title): TWO fully independent, equally-real
  // game binaries nested under bin/ (bg3.exe = Vulkan default, bg3_dx11.exe
  // = DX11 fallback), with no root-level executable at all. Neither name is
  // an Unreal Shipping binary, so this exercises the declared-executable-
  // order tie-break rather than the Shipping-binary one.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-steam-fixture-bg3-'));
  const steamapps = path.join(root, 'steamapps');
  const installDir = path.join(steamapps, 'common', 'Baldurs Gate 3');
  fs.mkdirSync(path.join(installDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(installDir, 'bin', 'bg3.exe'), '');
  fs.writeFileSync(path.join(installDir, 'bin', 'bg3_dx11.exe'), '');
  fs.writeFileSync(
    path.join(steamapps, 'appmanifest_1086940.acf'),
    `"AppState"
{
\t"appid"\t\t"1086940"
\t"name"\t\t"Baldur's Gate 3"
\t"installdir"\t\t"Baldurs Gate 3"
}
`,
  );
  const vdfPath = root.replace(/\\/g, '\\\\');
  fs.writeFileSync(
    path.join(steamapps, 'libraryfolders.vdf'),
    `"libraryfolders"
{
	"folders"
	{
		"0"
		{
			"path"		"${vdfPath}"
		}
	}
}
`,
  );
  return root;
}

describe('install-discovery steam scan — declared-order tie-break', () => {
  const steamRoot = makeBg3FixtureRoot();

  after(() => {
    fs.rmSync(steamRoot, { recursive: true, force: true });
  });

  test('resolves bg3.exe over bg3_dx11.exe using the hand-curated lookup table\'s declared order', () => {
    const games = scanSteamInstalls({ steamInstallPath: steamRoot });
    assert.equal(games.length, 1);
    assert.equal(games[0].steamAppId, 1086940);
    assert.ok(
      games[0].executablePath?.replace(/\\/g, '/').endsWith('bin/bg3.exe'),
      `expected bin/bg3.exe, got: ${games[0].executablePath}`,
    );
  });
});

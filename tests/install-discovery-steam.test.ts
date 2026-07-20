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

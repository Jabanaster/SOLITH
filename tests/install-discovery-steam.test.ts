import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVdf, vdfStringValue } from '../src/core/install-discovery/vdf.ts';
import { scanSteamInstalls } from '../src/core/install-discovery/steam.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STEAM_FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'steam-root');

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
  test('discovers Stardew Valley from fixture manifests', () => {
    const games = scanSteamInstalls({ steamInstallPath: STEAM_FIXTURE_ROOT });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'steam');
    assert.equal(games[0].steamAppId, 413150);
    assert.equal(games[0].displayName, 'Stardew Valley');
    assert.ok(games[0].installPath.toLowerCase().includes('stardew valley'));
    assert.ok(games[0].executablePath?.endsWith('Stardew Valley.exe'));
  });
});

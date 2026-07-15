import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanEpicInstalls } from '../src/core/install-discovery/epic.ts';
import { scanGogInstalls } from '../src/core/install-discovery/gog.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EPIC_MANIFESTS = path.join(__dirname, 'fixtures', 'epic-manifests');
const GOG_FIXTURE = path.join(__dirname, 'fixtures', 'gog-games.json');

describe('install-discovery epic scan', () => {
  test('discovers game from fixture .item manifests', () => {
    const games = scanEpicInstalls({ epicManifestsPath: EPIC_MANIFESTS });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'epic');
    assert.equal(games[0].displayName, 'Hades II');
    assert.ok(games[0].installPath.toLowerCase().includes('epic-game'));
    assert.ok(games[0].executablePath?.endsWith('Hades2.bin'));
  });

  test('returns empty when manifests dir missing', () => {
    const games = scanEpicInstalls({ epicManifestsPath: path.join(__dirname, 'fixtures', 'no-such-epic') });
    assert.equal(games.length, 0);
  });
});

describe('install-discovery gog scan', () => {
  test('discovers game from fixture JSON', () => {
    const games = scanGogInstalls({ gogFixturePath: GOG_FIXTURE });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'gog');
    assert.equal(games[0].displayName, 'GOG Demo Game');
    assert.ok(games[0].installPath.toLowerCase().includes('gog-game'));
    assert.ok(games[0].executablePath?.endsWith('DemoGame.bin'));
  });

  test('returns empty when fixture missing', () => {
    const games = scanGogInstalls({ gogFixturePath: path.join(__dirname, 'fixtures', 'no-gog.json') });
    assert.equal(games.length, 0);
  });
});

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanEpicInstalls } from '../src/core/install-discovery/epic.ts';
import { scanGogInstalls } from '../src/core/install-discovery/gog.ts';

function makeEpicFixture(): { manifests: string; game: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-epic-fixture-'));
  const game = path.join(root, 'epic-game');
  const manifests = path.join(root, 'epic-manifests');
  fs.mkdirSync(game, { recursive: true });
  fs.mkdirSync(manifests, { recursive: true });
  fs.writeFileSync(path.join(game, 'Hades2.bin'), '');
  fs.writeFileSync(
    path.join(manifests, 'Hades2.item'),
    JSON.stringify({
      DisplayName: 'Hades II',
      InstallLocation: game,
      LaunchExecutable: 'Hades2.bin',
      AppName: 'Hades2',
    }),
  );
  return { root, game, manifests };
}

function makeGogFixture(): { fixturePath: string; game: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-gog-fixture-'));
  const game = path.join(root, 'gog-game');
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'DemoGame.bin'), '');
  const fixturePath = path.join(root, 'gog-games.json');
  fs.writeFileSync(
    fixturePath,
    JSON.stringify([
      {
        path: game,
        exe: 'DemoGame.bin',
        gameName: 'GOG Demo Game',
      },
    ]),
  );
  return { root, game, fixturePath };
}

describe('install-discovery epic scan', () => {
  const epic = makeEpicFixture();

  after(() => {
    fs.rmSync(epic.root, { recursive: true, force: true });
  });

  test('discovers game from fixture .item manifests', () => {
    const games = scanEpicInstalls({ epicManifestsPath: epic.manifests });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'epic');
    assert.equal(games[0].displayName, 'Hades II');
    assert.ok(games[0].installPath.toLowerCase().includes('epic-game'));
    assert.ok(games[0].executablePath?.endsWith('Hades2.bin'));
  });

  test('returns empty when manifests dir missing', () => {
    const games = scanEpicInstalls({
      epicManifestsPath: path.join(os.tmpdir(), `solith-no-such-epic-${Date.now()}`),
    });
    assert.equal(games.length, 0);
  });
});

describe('install-discovery gog scan', () => {
  const gog = makeGogFixture();

  after(() => {
    fs.rmSync(gog.root, { recursive: true, force: true });
  });

  test('discovers game from fixture JSON', () => {
    const games = scanGogInstalls({ gogFixturePath: gog.fixturePath });
    assert.equal(games.length, 1);
    assert.equal(games[0].platform, 'gog');
    assert.equal(games[0].displayName, 'GOG Demo Game');
    assert.ok(games[0].installPath.toLowerCase().includes('gog-game'));
    assert.ok(games[0].executablePath?.endsWith('DemoGame.bin'));
  });

  test('returns empty when fixture missing', () => {
    const games = scanGogInstalls({
      gogFixturePath: path.join(os.tmpdir(), `solith-no-gog-${Date.now()}.json`),
    });
    assert.equal(games.length, 0);
  });
});

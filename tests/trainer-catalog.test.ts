import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrainerListHtml,
  parseRemoteTrainerIndexHtml,
  parseRemoteGameCatalogHtml,
  parseFlingTrainerOptionsHtml,
} from '../src/core/trainer-catalog/sync/parse-html.js';
import { remoteTrainerToModPack, remoteTrainerToCatalogEntry } from '../src/core/trainer-catalog/sync/remote-sync.js';
import { seedRecordToEntry } from '../src/core/trainer-catalog/seed.js';
import { buildSearchableText, validateModPack } from '../src/core/trainer-catalog/types.js';
import { resolveCatalogCoverUrl, toSolithAssetUrl } from '../src/core/trainer-catalog/cover-url.js';
import { FLING_TRAINER_PAGES } from '../src/core/cheat-system/trainer-reference.js';

describe('trainer catalog HTML parsers', () => {
  it('parses XenForo-style community forum trainer thread titles', () => {
    const html = `
      <a href="/threads/sniper-elite-resistance-trainer.123/">Sniper Elite: Resistance Trainer</a>
      <a href="/threads/cat-mail-co-trainer.456/">Cat Mail Co. Trainer</a>
    `;
    const trainers = parseTrainerListHtml('https://mrantifun.net', html);
    assert.ok(trainers.length >= 2);
    assert.ok(trainers.some((t) => t.gameName.includes('Sniper Elite')));
  });

  it('parses remote trainer index links', () => {
    const html = `<a href="/trainer/foo/">Palworld Trainer</a>`;
    const trainers = parseRemoteTrainerIndexHtml(html);
    assert.equal(trainers.length, 1);
    assert.equal(trainers[0].gameName, 'Palworld');
  });

  it('parses remote game catalog links', () => {
    const html = `<a href="/en/games/palworld">Palworld</a>`;
    const trainers = parseRemoteGameCatalogHtml(html);
    assert.equal(trainers.length, 1);
    assert.equal(trainers[0].gameName, 'Palworld');
  });
});

describe('remote trainer import', () => {
  it('builds community mod pack definitions without pointer paths', () => {
    const trainer = { title: 'Palworld Trainer', gameName: 'Palworld', sourceUrl: 'https://example.test/palworld' };
    const pack = remoteTrainerToModPack(trainer, 'mrantifun');
    assert.equal(pack.verificationStatus, 'community');
    assert.ok(pack.cheats.length >= 4);
    assert.ok(pack.cheats.every((c) => c.requiresDiscovery));
    assert.deepEqual(validateModPack(pack), []);
  });

  it('maps remote trainer to searchable catalog entry', () => {
    const trainer = { title: 'Dredge Trainer', gameName: 'Dredge', sourceUrl: 'https://example.test/dredge' };
    const entry = remoteTrainerToCatalogEntry(trainer, 'fling');
    assert.equal(entry.verificationStatus, 'community');
    assert.ok(entry.searchableText.includes('dredge'));
    assert.equal(entry.sources[0].provider, 'fling');
  });

  it('uses curated FLiNG option lists for bundled games', () => {
    const trainer = { title: 'Palworld Trainer', gameName: 'Palworld', sourceUrl: 'https://example.test/palworld' };
    const pack = remoteTrainerToModPack(trainer, 'fling');
    assert.equal(pack.cheats.length, FLING_TRAINER_PAGES.palworld.optionCount);
    assert.ok(pack.cheats.some((c) => c.name.includes('God Mode')));
    assert.equal(pack.connectionBaseline, 4);
  });
});

describe('FLiNG trainer option parser', () => {
  it('parses option hotkeys and names from trainer detail HTML', () => {
    const html = `
      48 Options · Game Version: v1.0+ · Last Updated: 2026.07.10
      Note: Single player mode only.
      ###### Options
      Num 1 – God Mode/Ignore Hits Num 2 – Lock Health Num 3 – Infinite Shield
      Ctrl+Num 9 – Freeze Daytime Ctrl+Num 0 – Time Pass Speed
      Shift+F1 – Edit Max Health Shift+F2 – Edit Max Shield
      ### Download
    `;
    const parsed = parseFlingTrainerOptionsHtml(html);
    assert.equal(parsed.optionCount, 48);
    assert.equal(parsed.soloOnly, true);
    assert.ok(parsed.options.length >= 6);
    assert.ok(parsed.options.some((o) => o.name === 'God Mode/Ignore Hits'));
    assert.ok(parsed.options.some((o) => o.hotkey === 'Shift+F1'));
  });
});

describe('seed catalog entries', () => {
  it('creates metadata-only steam catalog rows', () => {
    const entry = seedRecordToEntry({
      name: 'Elden Ring',
      steamAppId: 1245620,
      categories: ['RPG'],
    });
    assert.equal(entry.verificationStatus, 'metadata-only');
    assert.ok(entry.coverUrl?.includes('1245620'));
    assert.ok(buildSearchableText(entry).includes('elden ring'));
  });
});

describe('catalog cover URL safety', () => {
  it('routes absolute Windows cover files through the guarded Solith asset protocol', () => {
    const url = toSolithAssetUrl('C:\\Users\\chase\\AppData\\Roaming\\Solith\\covers\\avowed.jpg');
    assert.equal(
      url,
      'solith-asset://local/C%3A%5CUsers%5Cchase%5CAppData%5CRoaming%5CSolith%5Ccovers%5Cavowed.jpg',
    );
  });

  it('leaves remote Steam catalog cover URLs unchanged', () => {
    const entry = seedRecordToEntry({
      name: 'Elden Ring',
      steamAppId: 1245620,
      categories: ['RPG'],
    });
    assert.match(resolveCatalogCoverUrl(entry) ?? '', /^https:\/\/cdn\.[a-z]+\.steamstatic\.com\//);
  });
});

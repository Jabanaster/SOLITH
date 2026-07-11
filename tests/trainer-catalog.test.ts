import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrainerListHtml,
  parseFlingHomeHtml,
  parsePlitchGamesHtml,
} from '../src/core/trainer-catalog/sync/parse-html.js';
import { remoteTrainerToModPack, remoteTrainerToCatalogEntry } from '../src/core/trainer-catalog/sync/remote-sync.js';
import { seedRecordToEntry } from '../src/core/trainer-catalog/seed.js';
import { buildSearchableText, validateModPack } from '../src/core/trainer-catalog/types.js';

describe('trainer catalog HTML parsers', () => {
  it('parses XenForo-style MrAntiFun trainer thread titles', () => {
    const html = `
      <a href="/threads/sniper-elite-resistance-trainer.123/">Sniper Elite: Resistance Trainer</a>
      <a href="/threads/cat-mail-co-trainer.456/">Cat Mail Co. Trainer</a>
    `;
    const trainers = parseTrainerListHtml('https://mrantifun.net', html);
    assert.ok(trainers.length >= 2);
    assert.ok(trainers.some((t) => t.gameName.includes('Sniper Elite')));
  });

  it('parses FLiNG trainer links', () => {
    const html = `<a href="/trainer/foo/">Palworld Trainer</a>`;
    const trainers = parseFlingHomeHtml(html);
    assert.equal(trainers.length, 1);
    assert.equal(trainers[0].gameName, 'Palworld');
  });

  it('parses Plitch game links', () => {
    const html = `<a href="/en/games/palworld">Palworld</a>`;
    const trainers = parsePlitchGamesHtml(html);
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

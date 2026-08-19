import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrainerListHtml,
  parseRemoteTrainerIndexHtml,
  parseRemoteGameCatalogHtml,
  parseFlingTrainerOptionsHtml,
} from '../src/core/trainer-catalog/sync/parse-html.js';
import { decodeHtmlEntities } from '../src/core/trainer-catalog/sync/decode-html-entities.js';
import { isPlaceholderTitle } from '../src/core/trainer-catalog/sync/placeholder-titles.js';
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

  it('decodes HTML entities in scraped trainer thread titles', () => {
    const html = `<a href="/threads/baldurs-gate-3-trainer.789/">Baldur&#x27;s Gate 3 Trainer</a>`;
    const trainers = parseTrainerListHtml('https://mrantifun.net', html);
    assert.equal(trainers.length, 1);
    assert.equal(trainers[0].gameName, "Baldur's Gate 3");
    assert.ok(!trainers[0].gameName.includes('&#x27;'));
  });

  it('decodes HTML entities in remote trainer index links', () => {
    const html = `<a href="/trainer/foo/">Tom &amp; Jerry Trainer</a>`;
    const trainers = parseRemoteTrainerIndexHtml(html);
    assert.equal(trainers.length, 1);
    assert.equal(trainers[0].gameName, 'Tom & Jerry');
  });

  it('decodes HTML entities in remote game catalog links', () => {
    const html = `<a href="/en/games/foo">Foo &amp; Bar</a>`;
    const trainers = parseRemoteGameCatalogHtml(html);
    assert.equal(trainers.length, 1);
    assert.equal(trainers[0].gameName, 'Foo & Bar');
  });

  it('excludes placeholder-titled threads from XenForo-style scraping', () => {
    const html = `
      <a href="/threads/redacted-trainer.1/">[REDACTED] Trainer</a>
      <a href="/threads/real-game-trainer.2/">Real Game Trainer</a>
    `;
    const trainers = parseTrainerListHtml('https://mrantifun.net', html);
    assert.ok(!trainers.some((t) => t.gameName.toLowerCase().includes('redacted')));
    assert.ok(trainers.some((t) => t.gameName === 'Real Game'));
  });

  it('excludes placeholder-titled entries from remote trainer index links', () => {
    const html = `<a href="/trainer/foo/">[Hidden] Trainer</a>`;
    const trainers = parseRemoteTrainerIndexHtml(html);
    assert.equal(trainers.length, 0);
  });

  it('excludes placeholder-titled entries from remote game catalog links', () => {
    const html = `<a href="/en/games/foo">[TBA]</a>`;
    const trainers = parseRemoteGameCatalogHtml(html);
    assert.equal(trainers.length, 0);
  });
});

describe('isPlaceholderTitle', () => {
  it('matches exact placeholder words with or without brackets, case-insensitive', () => {
    assert.ok(isPlaceholderTitle('[REDACTED]'));
    assert.ok(isPlaceholderTitle('redacted'));
    assert.ok(isPlaceholderTitle('[Hidden]'));
    assert.ok(isPlaceholderTitle('TBA'));
    assert.ok(isPlaceholderTitle('[unannounced]'));
  });

  it('does not match legitimate titles that merely contain a placeholder word', () => {
    assert.ok(!isPlaceholderTitle('[NINJA GAIDEN - Master Collection] NINJA GAIDEN 3'));
    assert.ok(!isPlaceholderTitle('REDACTED Zone: A Real Game'));
    assert.ok(!isPlaceholderTitle('Hidden Folks'));
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named entities', () => {
    assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
    assert.equal(decodeHtmlEntities('Baldur&#x27;s Gate'), "Baldur's Gate");
    assert.equal(decodeHtmlEntities('&quot;Quoted&quot;'), '"Quoted"');
    assert.equal(decodeHtmlEntities('a &lt; b &gt; c'), 'a < b > c');
  });

  it('decodes decimal and hex numeric references', () => {
    assert.equal(decodeHtmlEntities('&#931;'), 'Σ');
    assert.equal(decodeHtmlEntities('&#x3A3;'), 'Σ');
  });

  it('leaves plain text and bare ampersands unchanged (idempotent, no double-decode)', () => {
    assert.equal(decodeHtmlEntities('Sniper Elite: Resistance'), 'Sniper Elite: Resistance');
    assert.equal(decodeHtmlEntities('Tom & Jerry'), 'Tom & Jerry');
    assert.equal(decodeHtmlEntities('AT&T'), 'AT&T');
  });

  it('leaves malformed or unknown entities untouched rather than corrupting text', () => {
    assert.equal(decodeHtmlEntities('&notarealentity;'), '&notarealentity;');
    assert.equal(decodeHtmlEntities('&#xZZZZ;'), '&#xZZZZ;');
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

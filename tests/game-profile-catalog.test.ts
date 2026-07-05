import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  getBundledGameProfileCatalog,
  getBundledGameProfileCatalogEntry,
  validateBundledGameProfileCatalog,
  validateGameProfileCatalogEntry,
} from '../src/core/game-profiles/index.js';

test('bundled game profile catalog is valid and deterministic', () => {
  const catalog = getBundledGameProfileCatalog();

  assert.deepEqual(
    catalog.map(entry => entry.catalogId),
    ['stardew-valley', 'demo-rpg-preview', 'demo-data-blocked'],
  );

  assert.deepEqual(validateBundledGameProfileCatalog(), []);

  const supported = getBundledGameProfileCatalogEntry('stardew-valley');
  assert.ok(supported);
  assert.equal(supported?.supportStatus, 'supported');
  assert.equal(supported?.evidenceLevel, 'backup-rollback-verified');

  const previewOnly = getBundledGameProfileCatalogEntry('demo-rpg-preview');
  assert.ok(previewOnly);
  assert.equal(previewOnly?.supportStatus, 'preview-only');
  assert.equal(previewOnly?.parserStatus, 'read-only');
  assert.equal(previewOnly?.writeSupportStatus, 'blocked');

  const blocked = getBundledGameProfileCatalogEntry('demo-data-blocked');
  assert.ok(blocked);
  assert.equal(blocked?.supportStatus, 'blocked');
  assert.ok(blocked?.unsupportedReasons.includes('write-not-supported'));

  for (const entry of catalog) {
    assert.equal(entry.localOnly, true);
    assert.equal(entry.offlineOnly, true);
    assert.equal(entry.singlePlayerOnly, true);

    for (const fixtureRef of entry.fixtureReferences) {
      assert.equal(fixtureRef.includes('://'), false);
      assert.equal(existsSync(path.resolve(fixtureRef)), true, fixtureRef);
    }
  }
});

test('catalog validation rejects remote or non-local references', () => {
  const errors = validateGameProfileCatalogEntry({
    catalogId: 'bad-catalog',
    gameId: 'bad-game',
    displayName: 'Bad Game',
    supportStatus: 'supported',
    parserStatus: 'supported',
    writeSupportStatus: 'supported',
    evidenceLevel: 'fixture-parsed',
    supportedFormats: ['xml'],
    unsupportedReasons: [],
    fixtureReferences: ['https://example.com/fixture.xml'],
    notes: [],
    warnings: [],
    localOnly: false,
    offlineOnly: true,
    singlePlayerOnly: true,
    profile: {
      profileVersion: '1.0.0',
      gameId: 'bad-game',
      displayName: 'Bad Game',
      saveFormat: 'xml',
      controls: [],
    },
  });

  assert.ok(errors.some(error => error.field === 'fixtureReferences[0]'));
  assert.ok(errors.some(error => error.field === 'localOnly'));
});

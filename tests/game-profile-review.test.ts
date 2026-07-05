import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBundledGameProfileCatalogEntry,
  reviewGameProfileExchange,
} from '../src/core/game-profiles/index.js';

test('game profile exchange review classifies supported, preview-only, and blocked entries', () => {
  const supported = reviewGameProfileExchange(
    getBundledGameProfileCatalogEntry('stardew-valley')!,
    { fixturePath: 'demo-game/save/stardew-fixture.xml' },
  );
  assert.equal(supported.status, 'supported');
  assert.equal(supported.importSupported, true);
  assert.equal(supported.exportSupported, true);
  assert.ok(supported.authoring.supportedOperations.includes('save_field_write'));
  assert.equal(supported.catalogErrors.length, 0);

  const previewOnly = reviewGameProfileExchange(
    getBundledGameProfileCatalogEntry('demo-rpg-preview')!,
    { fixturePath: 'demo-game/save/save1.json' },
  );
  assert.equal(previewOnly.status, 'preview-only');
  assert.equal(previewOnly.importSupported, true);
  assert.equal(previewOnly.exportSupported, false);
  assert.ok(previewOnly.authoring.supportedOperations.includes('save_field_read'));
  assert.ok(previewOnly.blockedReasons.some(reason => reason.startsWith('catalog:write-not-supported')));

  const blocked = reviewGameProfileExchange(
    getBundledGameProfileCatalogEntry('demo-data-blocked')!,
    { fixturePath: 'demo-game/data/items.json' },
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.importSupported, false);
  assert.equal(blocked.exportSupported, false);
  assert.equal(blocked.authoring.valid, false);
  assert.ok(blocked.blockedReasons.some(reason => reason.startsWith('save-format:')));
});

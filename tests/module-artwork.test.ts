import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_MODULE_ARTWORK, SECTION_ARTWORK } from '../src/app/assets/branding/module-artwork.ts';

describe('sidebar module artwork mapping', () => {
  test('custom nav artwork only on semantically matched items', () => {
    assert.deepEqual(NAV_MODULE_ARTWORK, {
      library: 'trainerController',
      trainer: 'trainerController',
      backups: 'recoveryPhoenix',
      'live-memory': 'trainerController',
      'multi-game-trainer': 'trainerController',
    });
  });

  test('hooded profile is not used in sidebar nav', () => {
    const values = Object.values(NAV_MODULE_ARTWORK);
    assert.ok(!values.includes('hoodedProfile'));
  });

  test('section artwork uses smaller grouping icons only', () => {
    assert.deepEqual(SECTION_ARTWORK, {
      Library: 'trainerController',
      'Core Tools': 'recoveryPhoenix',
      Advanced: 'advancedDragon',
    });
    assert.ok(!('Utilities' in SECTION_ARTWORK));
  });
});

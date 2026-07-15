import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_MODULE_ARTWORK, SECTION_ARTWORK } from '../src/app/assets/branding/module-artwork.ts';

describe('sidebar module artwork mapping', () => {
  test('custom nav artwork matches the current nav grouping', () => {
    assert.deepEqual(NAV_MODULE_ARTWORK, {
      library: 'trainerController',
      'trainer-library': 'trainerController',
      trainer: 'trainerController',
      saves: 'saveTools',
      controls: 'saveTools',
      backups: 'recoveryPhoenix',
      journal: 'recoveryPhoenix',
      locations: 'recoveryPhoenix',
      discovery: 'hoodedProfile',
      'trainer-research': 'hoodedProfile',
      data: 'hoodedProfile',
      compatibility: 'hoodedProfile',
      recipes: 'hoodedProfile',
      'session-monitor': 'advancedDragon',
      'live-memory': 'advancedDragon',
      'catalog-save-controls': 'saveTools',
    });
  });

  test('section artwork matches the current sidebar sections', () => {
    assert.deepEqual(SECTION_ARTWORK, {
      Library: 'trainerController',
      Recovery: 'recoveryPhoenix',
      'Save Tools': 'saveTools',
      Specialized: 'hoodedProfile',
      Advanced: 'advancedDragon',
    });
  });
});

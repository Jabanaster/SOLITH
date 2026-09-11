import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOnlineOperationAllowed,
  type OnlineServiceFeature,
} from '../src/core/settings/online-services-gate.ts';

const ALL_FEATURES: OnlineServiceFeature[] = [
  'community-sync',
  'catalog-refresh',
  'trainer-download',
  'trainer-upload',
  'provider-account-sync',
  'artwork-download',
];

describe('isOnlineOperationAllowed', () => {
  test('blocks every feature unconditionally when onlineServicesEnabled is false', () => {
    for (const feature of ALL_FEATURES) {
      assert.equal(
        isOnlineOperationAllowed({ onlineServicesEnabled: false }, feature),
        false,
        `expected ${feature} to be blocked when onlineServicesEnabled is false`,
      );
    }
  });

  test('permits every feature when onlineServicesEnabled is true', () => {
    for (const feature of ALL_FEATURES) {
      assert.equal(
        isOnlineOperationAllowed({ onlineServicesEnabled: true }, feature),
        true,
        `expected ${feature} to be allowed when onlineServicesEnabled is true`,
      );
    }
  });

  test('master OFF wins even if a per-feature flag would otherwise allow it', () => {
    // The gate has no knowledge of per-feature flags at all — it only
    // consults onlineServicesEnabled. This test documents that a caller
    // cannot bypass the master switch by passing a "the sub-flag is on"
    // signal; there is no such parameter, and OFF always wins.
    const settings = { onlineServicesEnabled: false };
    assert.equal(isOnlineOperationAllowed(settings, 'community-sync'), false);
    assert.equal(isOnlineOperationAllowed(settings, 'artwork-download'), false);
  });
});

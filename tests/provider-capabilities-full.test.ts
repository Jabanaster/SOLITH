import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { listProviderCapabilities, PROVIDER_CAPABILITIES } from '../src/core/install-discovery/provider-capabilities.ts';
import type { ExtendedCapabilityName } from '../src/core/install-discovery/provider-capabilities.ts';

const EXTENDED_CAPABILITY_NAMES: ExtendedCapabilityName[] = [
  'catalogDiscovery',
  'installedDiscovery',
  'ownedLibrarySync',
  'recentlyPlayed',
  'playtime',
  'artwork',
  'storeMetadata',
  'ratings',
  'popularity',
];

describe('provider capabilities — full honest capability matrix (Mission 4)', () => {
  test('every provider declares every capability in the full set', () => {
    for (const cap of listProviderCapabilities()) {
      for (const name of EXTENDED_CAPABILITY_NAMES) {
        assert.ok(
          cap.capabilities[name] !== undefined,
          `${cap.provider} is missing capability "${name}"`,
        );
        assert.ok(
          ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'REQUIRES_AUTH'].includes(cap.capabilities[name]),
          `${cap.provider}.${name} has an invalid status: ${cap.capabilities[name]}`,
        );
      }
    }
  });

  test('no provider claims ownedLibrarySync: SUPPORTED (no account-authorized API is implemented anywhere)', () => {
    for (const cap of listProviderCapabilities()) {
      assert.notEqual(
        cap.capabilities.ownedLibrarySync,
        'SUPPORTED',
        `${cap.provider} must not claim SUPPORTED ownedLibrarySync — no provider has this implemented`,
      );
    }
  });

  test('Phase 3: only Steam claims catalogDiscovery SUPPORTED (real, documented, wired-up IStoreService adapter)', () => {
    assert.equal(PROVIDER_CAPABILITIES.steam.capabilities.catalogDiscovery, 'SUPPORTED');
  });

  test('Phase 3: Epic and GOG claim catalogDiscovery PARTIAL, never SUPPORTED (real code, but built on undocumented/unofficial provider endpoints with no stability guarantee)', () => {
    assert.equal(PROVIDER_CAPABILITIES.epic.capabilities.catalogDiscovery, 'PARTIAL');
    assert.equal(PROVIDER_CAPABILITIES.gog.capabilities.catalogDiscovery, 'PARTIAL');
  });

  test('Ubisoft/EA/Xbox/Battle.net remain catalogDiscovery UNSUPPORTED (Mission 20 audit found no legitimate public catalog API for any of them)', () => {
    for (const provider of ['ubisoft', 'ea', 'xbox', 'battlenet'] as const) {
      assert.equal(PROVIDER_CAPABILITIES[provider].capabilities.catalogDiscovery, 'UNSUPPORTED', provider);
    }
  });

  test('no provider claims ratings or popularity beyond UNSUPPORTED (no reproducible source ingested)', () => {
    for (const cap of listProviderCapabilities()) {
      assert.equal(cap.capabilities.ratings, 'UNSUPPORTED', `${cap.provider}.ratings`);
      assert.equal(cap.capabilities.popularity, 'UNSUPPORTED', `${cap.provider}.popularity`);
    }
  });

  test('Steam is the only provider claiming artwork: SUPPORTED (real CDN allowlist wired in fetch-policy.ts)', () => {
    assert.equal(PROVIDER_CAPABILITIES.steam.capabilities.artwork, 'SUPPORTED');
    for (const cap of listProviderCapabilities()) {
      if (cap.provider !== 'steam') {
        assert.notEqual(cap.capabilities.artwork, 'SUPPORTED', `${cap.provider}.artwork`);
      }
    }
  });

  test('installedDiscovery in the extended matrix never contradicts installedDetectionLevel', () => {
    const levelToStatus: Record<string, string> = {
      supported: 'SUPPORTED',
      partial: 'PARTIAL',
      unsupported: 'UNSUPPORTED',
    };
    for (const cap of listProviderCapabilities()) {
      assert.equal(
        cap.capabilities.installedDiscovery,
        levelToStatus[cap.installedDetectionLevel],
        `${cap.provider}: installedDiscovery must mirror installedDetectionLevel`,
      );
    }
  });

  test('ownedLibrarySync is never SUPPORTED for providers with no account-authorized implementation, including REQUIRES_AUTH cases', () => {
    // REQUIRES_AUTH is allowed (Steam/GOG/Epic have a real, documented — if
    // unimplemented — auth-gated path per the Mission 6 audit); anything else
    // must be UNSUPPORTED, never SUPPORTED.
    for (const cap of listProviderCapabilities()) {
      assert.ok(
        cap.capabilities.ownedLibrarySync === 'REQUIRES_AUTH' || cap.capabilities.ownedLibrarySync === 'UNSUPPORTED',
        `${cap.provider}.ownedLibrarySync must be REQUIRES_AUTH or UNSUPPORTED, got ${cap.capabilities.ownedLibrarySync}`,
      );
    }
  });
});

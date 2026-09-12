import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { listProviderCapabilities, PROVIDER_CAPABILITIES } from '../src/core/install-discovery/provider-capabilities.ts';

/**
 * Personal Library Completion pass, Phase 2, Mission 19 — the new 3-level
 * (supported/partial/unsupported) capability fields. Proves the new fields
 * are internally consistent with the existing boolean fields (never
 * contradicting them) and reflect the real, documented per-provider
 * findings: Ubisoft/Steam/GOG/Epic supported-installed, EA/Xbox/Battle.net
 * partial-installed, and NO provider claims any ownership-detection level
 * beyond unsupported today.
 */
describe('Mission 19 — installedDetectionLevel is consistent with localDiscoverySupported', () => {
  test('every provider with localDiscoverySupported:true has installedDetectionLevel "supported"', () => {
    for (const cap of listProviderCapabilities()) {
      if (cap.localDiscoverySupported) {
        assert.equal(cap.installedDetectionLevel, 'supported', `${cap.provider} should be 'supported'`);
      }
    }
  });

  test('Steam, GOG, Epic, Ubisoft are installedDetectionLevel "supported"', () => {
    for (const provider of ['steam', 'gog', 'epic', 'ubisoft'] as const) {
      assert.equal(PROVIDER_CAPABILITIES[provider].installedDetectionLevel, 'supported');
    }
  });

  test('EA, Xbox, and Battle.net are installedDetectionLevel "partial" (real code exists, not reliable enough for "supported")', () => {
    assert.equal(PROVIDER_CAPABILITIES.ea.installedDetectionLevel, 'partial');
    assert.equal(PROVIDER_CAPABILITIES.xbox.installedDetectionLevel, 'partial');
    assert.equal(PROVIDER_CAPABILITIES.battlenet.installedDetectionLevel, 'partial');
    // All three must still have a real implementationFile — 'partial' is not the same as 'unsupported'.
    assert.ok(PROVIDER_CAPABILITIES.ea.implementationFile);
    assert.ok(PROVIDER_CAPABILITIES.xbox.implementationFile);
    assert.ok(PROVIDER_CAPABILITIES.battlenet.implementationFile);
  });

  test('no provider is installedDetectionLevel "partial" without a real implementationFile (never fabricate partial provenance)', () => {
    for (const cap of listProviderCapabilities()) {
      if (cap.installedDetectionLevel === 'partial') {
        assert.ok(cap.implementationFile, `${cap.provider} claims partial support but has no implementationFile`);
      }
    }
  });
});

describe('Mission 19 — ownershipDetectionLevel never overclaims', () => {
  test('every provider is ownershipDetectionLevel "unsupported" (no account API implemented for any provider)', () => {
    for (const cap of listProviderCapabilities()) {
      assert.equal(cap.ownershipDetectionLevel, 'unsupported', `${cap.provider} must not claim ownership detection`);
    }
  });

  test('every provider is ownershipSource "unavailable" — installed-only evidence is never mislabeled as an ownership source', () => {
    for (const cap of listProviderCapabilities()) {
      assert.equal(cap.ownershipSource, 'unavailable', `${cap.provider} must not claim a real ownership source`);
    }
  });

  test('ownershipDetectionLevel is consistent with fullOwnershipSupported (both say "no" for every provider)', () => {
    for (const cap of listProviderCapabilities()) {
      assert.equal(cap.fullOwnershipSupported, false);
      assert.equal(cap.ownershipDetectionLevel, 'unsupported');
    }
  });
});

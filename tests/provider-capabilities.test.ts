import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { listProviderCapabilities, PROVIDER_CAPABILITIES } from '../src/core/install-discovery/provider-capabilities.ts';

describe('Linked Library provider capabilities — honest, sourced from real scanners', () => {
  test('all 7 target platforms are represented', () => {
    const providers = listProviderCapabilities().map((p) => p.provider);
    for (const expected of ['steam', 'gog', 'epic', 'ubisoft', 'ea', 'xbox', 'battlenet']) {
      assert.ok(providers.includes(expected as never), `missing provider ${expected}`);
    }
  });

  test('Steam/GOG/Epic/Ubisoft report local discovery supported (real, reasonably reliable scanners exist)', () => {
    assert.equal(PROVIDER_CAPABILITIES.steam.localDiscoverySupported, true);
    assert.equal(PROVIDER_CAPABILITIES.gog.localDiscoverySupported, true);
    assert.equal(PROVIDER_CAPABILITIES.epic.localDiscoverySupported, true);
    assert.equal(PROVIDER_CAPABILITIES.ubisoft.localDiscoverySupported, true);
  });

  test('EA/Battle.net/Xbox report NOT supported (PARTIAL/best-effort or nothing) — must never be overclaimed', () => {
    assert.equal(PROVIDER_CAPABILITIES.ea.localDiscoverySupported, false);
    assert.equal(PROVIDER_CAPABILITIES.battlenet.localDiscoverySupported, false);
    assert.equal(PROVIDER_CAPABILITIES.xbox.localDiscoverySupported, false);
  });

  test('no provider claims full ownership support (no account API is implemented anywhere)', () => {
    for (const cap of listProviderCapabilities()) {
      assert.equal(cap.fullOwnershipSupported, false, `${cap.provider} must not claim full ownership support`);
    }
  });

  test('every SUPPORTED provider has a real implementationFile (no fabricated provenance)', () => {
    for (const cap of listProviderCapabilities()) {
      if (cap.localDiscoverySupported) {
        assert.ok(cap.implementationFile, `${cap.provider} claims discovery but has no implementationFile`);
      }
    }
  });

  test('EA, Xbox, and Battle.net have PARTIAL implementations — implementationFile set but not claimed SUPPORTED', () => {
    assert.equal(PROVIDER_CAPABILITIES.ea.localDiscoverySupported, false);
    assert.ok(PROVIDER_CAPABILITIES.ea.implementationFile, 'ea should have a real implementationFile for provenance');
    assert.equal(PROVIDER_CAPABILITIES.xbox.localDiscoverySupported, false);
    assert.ok(PROVIDER_CAPABILITIES.xbox.implementationFile, 'xbox should have a real implementationFile for provenance');
    assert.equal(PROVIDER_CAPABILITIES.battlenet.localDiscoverySupported, false);
    assert.ok(
      PROVIDER_CAPABILITIES.battlenet.implementationFile,
      'battlenet should have a real implementationFile for provenance (re-investigated: standard Windows Uninstall registry entries)',
    );
  });
});

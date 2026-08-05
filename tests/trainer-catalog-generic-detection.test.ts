import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isGenericTemplateEntry } from '../src/app/pages/trainer-catalog-generic-detection.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function genericEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'test-game',
    displayName: 'Test Game',
    executables: ['Test.exe'],
    categories: ['Action', 'Single Player'],
    verificationStatus: 'community',
    sources: [{ provider: 'mrantifun', url: 'https://mrantifun.net/test' }],
    hasModPack: true,
    cheatCount: 4,
    searchableText: 'test game',
    ...overrides,
  };
}

describe('isGenericTemplateEntry — conservative detector, false positives are the worse failure mode', () => {
  test('flags the exact remote-sync fallback shape as generic', () => {
    assert.equal(isGenericTemplateEntry(genericEntry()), true);
  });

  test('false negative is acceptable: not every under-specified entry needs to be flagged', () => {
    // A single field drifting from the exact template (here: an extra
    // category) is intentionally NOT flagged — the detector requires the
    // literal fallback shape, not "looks sparse."
    const entry = genericEntry({ categories: ['Action', 'Single Player', 'Indie'] });
    assert.equal(isGenericTemplateEntry(entry), false);
  });

  test('false positive avoided: real categories differing from the exact fallback shape are never flagged', () => {
    assert.equal(isGenericTemplateEntry(genericEntry({ categories: ['RPG', 'Single Player'] })), false);
    assert.equal(isGenericTemplateEntry(genericEntry({ categories: ['Action'] })), false);
    assert.equal(isGenericTemplateEntry(genericEntry({ categories: [] })), false);
  });

  test('false positive avoided: cheatCount other than the exact fallback value (4) is never flagged', () => {
    assert.equal(isGenericTemplateEntry(genericEntry({ cheatCount: 3 })), false);
    assert.equal(isGenericTemplateEntry(genericEntry({ cheatCount: 0 })), false);
    assert.equal(isGenericTemplateEntry(genericEntry({ cheatCount: 12 })), false);
  });

  test('false positive avoided: any curated/bundled/user/ct-import/solith-hub source present means "not generic," full stop', () => {
    for (const provider of ['bundled', 'user', 'ct-import', 'solith-hub', 'community', 'fearless'] as const) {
      const entry = genericEntry({ sources: [{ provider, url: 'https://example.test' }] });
      assert.equal(isGenericTemplateEntry(entry), false, `provider ${provider} should not be flagged generic`);
    }
  });

  test('false positive avoided: a mix of a generic-only provider and a curated provider is not flagged', () => {
    const entry = genericEntry({
      sources: [
        { provider: 'mrantifun', url: 'https://mrantifun.net/test' },
        { provider: 'user', url: 'local://user' },
      ],
    });
    assert.equal(isGenericTemplateEntry(entry), false);
  });

  test('false positive avoided: no sources at all is not flagged (nothing to confirm as remote-sync-only)', () => {
    assert.equal(isGenericTemplateEntry(genericEntry({ sources: [] })), false);
  });

  test('false positive avoided: a verified entry is never flagged generic, even if the shape otherwise matches exactly', () => {
    assert.equal(isGenericTemplateEntry(genericEntry({ verificationStatus: 'verified' })), false);
  });

  test('recognizes all known generic-only remote providers (fling, mrantifun, plitch, remote-listing)', () => {
    for (const provider of ['fling', 'mrantifun', 'plitch', 'remote-listing'] as const) {
      const entry = genericEntry({ sources: [{ provider, url: 'https://example.test' }] });
      assert.equal(isGenericTemplateEntry(entry), true, `provider ${provider} should be flagged generic`);
    }
  });
});

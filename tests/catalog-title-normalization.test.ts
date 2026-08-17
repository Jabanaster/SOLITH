import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogTitle } from '../src/core/trainer-catalog/normalize-title.js';

describe('normalizeCatalogTitle', () => {
  it('preserves valid titles with punctuation and Unicode unchanged', () => {
    const valid = [
      'Cyberpunk 2077',
      "Baldur's Gate 3",
      'Tom Clancy’s Ghost Recon® Breakpoint',
      'NieR:Automata™',
      "[NINJA GAIDEN - Master Collection] NINJA GAIDEN 3 - Razor's Edge",
      'FINAL FANTASY VII REMAKE INTERGRADE',
    ];
    for (const title of valid) {
      assert.equal(normalizeCatalogTitle(title), title);
    }
  });

  it('extracts text content from a well-formed HTML anchor', () => {
    const raw = '<a href="https://gametrainers.com/foo">Cyberpunk 2077</a>';
    assert.equal(normalizeCatalogTitle(raw), 'Cyberpunk 2077');
  });

  it('rejects a broken markup fragment instead of storing it as-is', () => {
    const raw = 'a href="https://gametrainers.com/foo"';
    assert.equal(normalizeCatalogTitle(raw), null);
  });

  it('rejects the real observed XenForo nav-menu attribute fragment', () => {
    const raw = 'a href="https://gametrainers.com"\n\t\tclass="menu-linkRow u-indentDepth0 js-offCanvasCopy "\n\t\t Game';
    assert.equal(normalizeCatalogTitle(raw), null);
  });

  it('collapses pathological repeated whitespace', () => {
    assert.equal(normalizeCatalogTitle('   Cyberpunk    2077   '), 'Cyberpunk 2077');
  });

  it('rejects empty or markup-only values', () => {
    assert.equal(normalizeCatalogTitle('<a href="https://x.test"></a>'), null);
    assert.equal(normalizeCatalogTitle('<br>'), null);
    assert.equal(normalizeCatalogTitle('   '), null);
    assert.equal(normalizeCatalogTitle(''), null);
    assert.equal(normalizeCatalogTitle(null), null);
    assert.equal(normalizeCatalogTitle(undefined), null);
  });

  it('rejects URL-only values', () => {
    assert.equal(normalizeCatalogTitle('https://gametrainers.com/foo/bar'), null);
  });

  it('decodes HTML entities in otherwise valid titles', () => {
    assert.equal(normalizeCatalogTitle('Cyberpunk 2077 &amp; Phantom Liberty'), 'Cyberpunk 2077 & Phantom Liberty');
  });

  it('enforces a maximum length without throwing', () => {
    const longTitle = 'A'.repeat(500);
    const result = normalizeCatalogTitle(longTitle);
    assert.ok(result !== null && result.length <= 200);
  });
});

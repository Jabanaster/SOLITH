/**
 * DiscoveryPage.tsx — source-inspection tests (Discovery Master Pass, Stage
 * 2). Follows this repo's established pattern for components importing a
 * `.module.css` file (see game-detail-page.test.ts's header): Node's plain
 * `tsx --test` runner has no CSS loader, so behavior is verified against the
 * real source text rather than a render.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

const DISCOVERY_PAGE = readSource('src/app/pages/DiscoveryPage.tsx');
const APP_TSX = readSource('src/app/App.tsx');

describe('DiscoveryPage — card activation navigates to game-detail', () => {
  test('GameCard onSelect is wired to the real onSelectGame prop, not a no-op', () => {
    assert.match(DISCOVERY_PAGE, /onSelect=\{onSelectGame\}/);
  });

  test('App.tsx wires Discovery to handleLibraryGameSelect (the real navigation handler)', () => {
    assert.match(APP_TSX, /<DiscoveryPage onSelectGame=\{handleLibraryGameSelect\}\s*\/>/);
  });
});

describe('DiscoveryPage — favorite button is not nested inside an interactive GameCard', () => {
  test('the favorite button is a DOM sibling of GameCard, not a descendant (invalid nested-interactive markup)', () => {
    // Structural check: GameCard renders and closes before the favorite
    // button opens, both inside the same non-interactive wrapper div.
    const cardWrapMatch = DISCOVERY_PAGE.match(/<div key=\{[^}]+\} className=\{styles\.cardWrap\}>([\s\S]*?)<\/div>/);
    assert.ok(cardWrapMatch, 'expected a .cardWrap element wrapping the card and favorite button');
    const wrapBody = cardWrapMatch![1];
    const gameCardIndex = wrapBody.indexOf('<GameCard');
    const gameCardCloseIndex = wrapBody.indexOf('/>', gameCardIndex);
    const favoriteButtonIndex = wrapBody.indexOf('<button', gameCardCloseIndex);
    assert.ok(gameCardIndex >= 0 && gameCardCloseIndex > gameCardIndex && favoriteButtonIndex > gameCardCloseIndex);
  });
});

describe('DiscoveryPage — never fabricates bulk artwork for non-personal games', () => {
  test('does not pass artworkUrl when building card data (prose comments explaining why are fine)', () => {
    assert.doesNotMatch(DISCOVERY_PAGE, /artworkUrl[:=]/);
  });
});

describe('DiscoveryPage — only certified bulk-catalog providers are offered as filters', () => {
  test('provider options are limited to Steam/Epic/GOG (plus All)', () => {
    const optionsMatch = DISCOVERY_PAGE.match(/const PROVIDER_OPTIONS[\s\S]*?\];/);
    assert.ok(optionsMatch);
    for (const forbidden of ['ubisoft', 'ea', 'xbox', 'battlenet']) {
      assert.doesNotMatch(optionsMatch![0], new RegExp(`value:\\s*'${forbidden}'`));
    }
    for (const allowed of ['steam', 'epic', 'gog']) {
      assert.match(optionsMatch![0], new RegExp(`value:\\s*'${allowed}'`));
    }
  });
});

describe('DiscoveryPage — search request includes the new Stage 2 filters', () => {
  test('discoveryCatalogSearch is called with releaseYearMin/Max and sort', () => {
    assert.match(DISCOVERY_PAGE, /releaseYearMin/);
    assert.match(DISCOVERY_PAGE, /releaseYearMax/);
    assert.match(DISCOVERY_PAGE, /sort:\s*searchSort/);
  });

  test('year inputs are parsed via parseYear before reaching the query (never a raw/NaN value)', () => {
    assert.match(DISCOVERY_PAGE, /parseYear\(releaseYearMinInput\)/);
    assert.match(DISCOVERY_PAGE, /parseYear\(releaseYearMaxInput\)/);
  });
});

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.js';
import { upsertCanonicalGame } from '../src/core/canonical-games/store.js';
import type { CanonicalGame } from '../src/core/canonical-games/types.js';
import { createCatalogGameIdentityBridge } from '../src/core/adaptive-wisp/catalog-game-identity-bridge.js';

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now()}-${uid}`;
}

function makeCanonicalGame(overrides: Partial<CanonicalGame> & { id: string }): CanonicalGame {
  const now = new Date(0).toISOString();
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    normalizedTitle: overrides.normalizedTitle ?? overrides.id.toLowerCase(),
    aliases: overrides.aliases ?? [],
    genres: overrides.genres ?? [],
    playModes: overrides.playModes ?? [],
    eligibility: overrides.eligibility ?? 'eligible',
    supportState: overrides.supportState ?? 'supported',
    catalogGameId: overrides.catalogGameId,
    identityStatus: overrides.identityStatus ?? 'verified',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe('Adaptive Wisp Increment 4B — real catalog game identity bridge', () => {
  before(async () => {
    await initDatabase();
  });

  test('exact match: canonical game with catalogGameId resolves to it', () => {
    const id = nextId('canon-alpha');
    upsertCanonicalGame(makeCanonicalGame({ id, catalogGameId: 'catalog-alpha' }));
    const bridge = createCatalogGameIdentityBridge();
    assert.equal(bridge.resolveCheatSystemGameId(id), 'catalog-alpha');
  });

  test('exact match: a second, differently-titled canonical game resolves independently', () => {
    const idA = nextId('space-game');
    const idB = nextId('space-game-deluxe');
    upsertCanonicalGame(makeCanonicalGame({ id: idA, displayName: 'Space Game', catalogGameId: 'catalog-space' }));
    upsertCanonicalGame(makeCanonicalGame({ id: idB, displayName: 'Space Game Deluxe', catalogGameId: 'catalog-space-deluxe' }));
    const bridge = createCatalogGameIdentityBridge();
    assert.equal(bridge.resolveCheatSystemGameId(idA), 'catalog-space');
    assert.equal(bridge.resolveCheatSystemGameId(idB), 'catalog-space-deluxe');
  });

  test('canonical game with no catalogGameId fails closed to null', () => {
    const id = nextId('canon-no-catalog');
    upsertCanonicalGame(makeCanonicalGame({ id }));
    const bridge = createCatalogGameIdentityBridge();
    assert.equal(bridge.resolveCheatSystemGameId(id), null);
  });

  test('unknown canonical game id fails closed to null', () => {
    const bridge = createCatalogGameIdentityBridge();
    assert.equal(bridge.resolveCheatSystemGameId('does-not-exist-' + nextId('x')), null);
  });

  test('no fuzzy/display-name matching: similar titles never cross-resolve', () => {
    const idA = nextId('avowed');
    const idB = nextId('avowed-remastered');
    upsertCanonicalGame(makeCanonicalGame({ id: idA, displayName: 'Avowed', catalogGameId: 'catalog-avowed' }));
    upsertCanonicalGame(makeCanonicalGame({ id: idB, displayName: 'Avowed Remastered', catalogGameId: 'catalog-avowed-remastered' }));
    const bridge = createCatalogGameIdentityBridge();
    assert.notEqual(bridge.resolveCheatSystemGameId(idA), bridge.resolveCheatSystemGameId(idB));
  });

  test('prototype-pollution-shaped canonical ids do not resolve to inherited junk', () => {
    const bridge = createCatalogGameIdentityBridge();
    assert.equal(bridge.resolveCheatSystemGameId('toString'), null);
    assert.equal(bridge.resolveCheatSystemGameId('constructor'), null);
  });
});

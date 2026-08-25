import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createExplicitGameIdentityBridge, createCheatSystemEntryLookup } from '../src/core/adaptive-wisp/index.ts';

describe('WispGameIdentityBridge (Increment 4, Section 3-4, 39)', () => {
  test('canonical Alpha resolves to cheat Alpha', () => {
    const bridge = createExplicitGameIdentityBridge({ 'canonical:alpha-hash': 'cheat-alpha' });
    assert.equal(bridge.resolveCheatSystemGameId('canonical:alpha-hash'), 'cheat-alpha');
  });

  test('canonical Beta resolves to cheat Beta', () => {
    const bridge = createExplicitGameIdentityBridge({ 'canonical:beta-hash': 'cheat-beta' });
    assert.equal(bridge.resolveCheatSystemGameId('canonical:beta-hash'), 'cheat-beta');
  });

  test('an unknown canonical game fails closed to null', () => {
    const bridge = createExplicitGameIdentityBridge({ 'canonical:alpha-hash': 'cheat-alpha' });
    assert.equal(bridge.resolveCheatSystemGameId('canonical:unknown-hash'), null);
  });

  test('similar canonical display-like ids never get confused with each other — exact match only', () => {
    const bridge = createExplicitGameIdentityBridge({ 'canonical:alpha-hash': 'cheat-alpha', 'canonical:alpha-hash-2': 'cheat-alpha-remaster' });
    assert.equal(bridge.resolveCheatSystemGameId('canonical:alpha-hash'), 'cheat-alpha');
    assert.equal(bridge.resolveCheatSystemGameId('canonical:alpha-hash-2'), 'cheat-alpha-remaster');
    // A near-miss id (not registered) must never fall back to a "close enough" match.
    assert.equal(bridge.resolveCheatSystemGameId('canonical:alpha-hash-3'), null);
  });

  test('an empty bridge never guesses — every lookup fails closed', () => {
    const bridge = createExplicitGameIdentityBridge({});
    assert.equal(bridge.resolveCheatSystemGameId('canonical:anything'), null);
  });

  test('a missing mapping makes an otherwise-real entry unavailable through the cheat-system lookup adapter', () => {
    const bridge = createExplicitGameIdentityBridge({});
    const lookup = createCheatSystemEntryLookup(bridge);
    // No mapping registered for this canonical id, so the lookup must fail closed regardless of what
    // the cheat-system catalog actually contains — it never even reaches getGameConfig.
    assert.equal(lookup.resolveEntry('canonical:unmapped', 'health'), null);
  });

  test('prototype-pollution-shaped keys are never treated as a match (own-property check, not `in`)', () => {
    const bridge = createExplicitGameIdentityBridge({ 'canonical:alpha-hash': 'cheat-alpha' });
    assert.equal(bridge.resolveCheatSystemGameId('toString'), null);
    assert.equal(bridge.resolveCheatSystemGameId('constructor'), null);
  });
});

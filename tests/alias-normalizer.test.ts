import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGameSlug, findAliasCollisions } from '../scripts/lib/alias-normalizer.mjs';

describe('alias-normalizer (roman-numeral false-positive fix)', () => {
  test('Dragon Quest I & II and Dragon Quest III remain distinct', () => {
    const a = normalizeGameSlug('dragon-quest-i-ii-hd-2d-remake');
    const b = normalizeGameSlug('dragon-quest-iii-hd-2d-remake');
    assert.notEqual(a, b);
    assert.deepEqual(findAliasCollisions(['dragon-quest-i-ii-hd-2d-remake', 'dragon-quest-iii-hd-2d-remake']), []);
  });

  test('genuine collisions are still caught', () => {
    const cases = [
      ['pal-world', 'palworld'],
      ['witcher-3', 'the-witcher-3'],
      ['dark-souls', 'darksouls'],
      ['fallout-3', 'fallout3'],
      ['grandia-2', 'grandia2'],
      ['nioh-3', 'nioh3'],
      ['tower-of-time', 'toweroftime'],
      ['heroes-4', 'heroes4'],
    ];
    for (const [a, b] of cases) {
      assert.equal(normalizeGameSlug(a), normalizeGameSlug(b), `${a} should collide with ${b}`);
    }
  });

  test('unrelated games never collide', () => {
    assert.notEqual(normalizeGameSlug('cyberpunk-2077'), normalizeGameSlug('subnautica'));
    assert.notEqual(normalizeGameSlug('dragon-quest-xi'), normalizeGameSlug('dragon-quest-iv'));
  });
});

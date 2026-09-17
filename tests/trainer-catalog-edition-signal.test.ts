import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEditionSignal, groupCatalogEntriesByEdition } from '../src/core/trainer-catalog/edition-signal.ts';

describe('detectEditionSignal', () => {
  test('detects a colon-separated edition suffix and strips it to the base title', () => {
    const signal = detectEditionSignal('Cyberpunk 2077: Ultimate Edition');
    assert.ok(signal);
    assert.equal(signal?.baseTitle, 'Cyberpunk 2077');
    assert.match(signal!.editionLabel, /Ultimate Edition/i);
  });

  test('detects "Game of the Year Edition"', () => {
    const signal = detectEditionSignal('The Witcher 3: Wild Hunt - Game of the Year Edition');
    assert.ok(signal);
    assert.equal(signal?.baseTitle, 'The Witcher 3: Wild Hunt');
  });

  test('detects GOTY abbreviation on its own', () => {
    const signal = detectEditionSignal('Fallout 4 GOTY');
    assert.ok(signal);
  });

  test('detects Definitive/Remastered/Deluxe/Gold/Complete/Enhanced edition suffixes', () => {
    for (const title of [
      'Grim Fandango Remastered Edition',
      'Persona 5 Royal Deluxe Edition',
      'The Last of Us Definitive Edition',
      'Skyrim Legendary Edition',
      'Overwatch Gold Edition',
      'Borderlands Game of the Year Edition',
    ]) {
      assert.ok(detectEditionSignal(title), `expected an edition signal for "${title}"`);
    }
  });

  test('returns undefined for a title with no edition keyword — never guesses a split', () => {
    assert.equal(detectEditionSignal('Stardew Valley'), undefined);
    assert.equal(detectEditionSignal('Palworld'), undefined);
  });

  test('does not false-positive on a title that merely contains "gold" as a normal word, not "Gold Edition"', () => {
    assert.equal(detectEditionSignal('Goldeneye 007'), undefined);
  });
});

describe('groupCatalogEntriesByEdition', () => {
  test('groups a base title with its detected edition variant', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'cp2077', displayName: 'Cyberpunk 2077' },
      { catalogGameId: 'cp2077-ultimate', displayName: 'Cyberpunk 2077: Ultimate Edition' },
      { catalogGameId: 'unrelated', displayName: 'Stardew Valley' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].members.length, 2);
    assert.deepEqual(
      groups[0].members.map((m) => m.catalogGameId).sort(),
      ['cp2077', 'cp2077-ultimate'],
    );
  });

  test('a lone entry (no other catalog row shares its base title) is not reported as a group', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'solo', displayName: 'Some Unique Game: Deluxe Edition' },
    ]);
    assert.deepEqual(groups, []);
  });

  test('flags suspected duplicate content when two grouped members share an identical content hash', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'a', displayName: 'Foo', contentHash: 'deadbeef' },
      { catalogGameId: 'b', displayName: 'Foo: Deluxe Edition', contentHash: 'deadbeef' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].suspectedDuplicateContent, true);
  });

  test('does not flag suspected duplicate content when grouped members have distinct content hashes', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'a', displayName: 'Foo', contentHash: 'aaaa' },
      { catalogGameId: 'b', displayName: 'Foo: Deluxe Edition', contentHash: 'bbbb' },
    ]);
    assert.equal(groups[0].suspectedDuplicateContent, false);
  });

  test('does not flag suspected duplicate content when content hashes are unknown', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'a', displayName: 'Foo' },
      { catalogGameId: 'b', displayName: 'Foo: Deluxe Edition' },
    ]);
    assert.equal(groups[0].suspectedDuplicateContent, false);
  });

  test('two unrelated titles with no shared base title are never grouped', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'a', displayName: 'Foo: Deluxe Edition' },
      { catalogGameId: 'b', displayName: 'Bar: Ultimate Edition' },
    ]);
    assert.deepEqual(groups, []);
  });

  test('two catalog rows with the exact same bare title (no edition keyword) are still grouped — a real data-quality signal', () => {
    const groups = groupCatalogEntriesByEdition([
      { catalogGameId: 'a', displayName: 'Doom' },
      { catalogGameId: 'b', displayName: 'Doom' },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].members.length, 2);
  });
});

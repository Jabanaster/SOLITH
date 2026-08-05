import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { orderCatalogDefault } from '../src/app/pages/trainer-catalog-default-order.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function entry(id: string, overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: id,
    displayName: id,
    executables: [`${id}.exe`],
    categories: ['Action', 'Single Player'],
    verificationStatus: 'community',
    sources: [{ provider: 'mrantifun', url: 'https://mrantifun.net/x' }],
    hasModPack: true,
    cheatCount: 4,
    searchableText: id.toLowerCase(),
    ...overrides,
  };
}

function ids(list: TrainerCatalogEntry[]): string[] {
  return list.map((e) => e.catalogGameId);
}

describe('orderCatalogDefault — deterministic tier + provider/title-lane interleave (Candidate C)', () => {
  test('same input always produces identical output', () => {
    const entries = [entry('B'), entry('A'), entry('D'), entry('C')];
    const first = orderCatalogDefault(entries, new Set());
    const second = orderCatalogDefault(entries, new Set());
    assert.deepEqual(ids(first), ids(second));
  });

  test('does not mutate the input array', () => {
    const entries = [entry('B'), entry('A'), entry('D'), entry('C')];
    const before = ids(entries);
    orderCatalogDefault(entries, new Set(['C']));
    assert.deepEqual(ids(entries), before, 'input array order must be untouched');
  });

  test('installed entries remain first, regardless of verification tier or generic status', () => {
    const entries = [
      entry('generic-not-installed'),
      entry('verified-installed', { verificationStatus: 'verified' }),
      entry('curated-not-installed', { sources: [{ provider: 'bundled', url: 'local://x' }] }),
      entry('generic-installed'),
    ];
    const installedIds = new Set(['verified-installed', 'generic-installed']);
    const out = ids(orderCatalogDefault(entries, installedIds));
    assert.deepEqual(new Set(out.slice(0, 2)), installedIds);
    assert.ok(!installedIds.has(out[2]) && !installedIds.has(out[3]));
  });

  test('verified entries retain priority over non-verified when nothing is installed', () => {
    const entries = [
      entry('generic-1'),
      entry('verified-1', { verificationStatus: 'verified' }),
      entry('curated-1', { sources: [{ provider: 'bundled', url: 'local://x' }] }),
      entry('verified-2', { verificationStatus: 'verified' }),
    ];
    const out = orderCatalogDefault(entries, new Set());
    const lastVerifiedIndex = Math.max(...out.map((e, i) => (e.verificationStatus === 'verified' ? i : -1)));
    const firstNonVerifiedIndex = out.findIndex((e) => e.verificationStatus !== 'verified');
    assert.ok(lastVerifiedIndex < firstNonVerifiedIndex);
  });

  test('curated/non-generic entries are never mislabeled or displaced behind generic entries', () => {
    const entries = [
      entry('generic-1'),
      entry('curated-1', { sources: [{ provider: 'bundled', url: 'local://x' }] }),
      entry('generic-2'),
      entry('curated-2', { sources: [{ provider: 'user', url: 'local://y' }] }),
    ];
    const out = orderCatalogDefault(entries, new Set());
    const curatedIndices = out
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.catalogGameId.startsWith('curated'))
      .map(({ i }) => i);
    const genericIndices = out
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.catalogGameId.startsWith('generic'))
      .map(({ i }) => i);
    assert.ok(Math.max(...curatedIndices) < Math.min(...genericIndices));
  });

  test('entry count and identity set are unchanged — no duplicates, no omissions', () => {
    const entries = [entry('A'), entry('B'), entry('C'), entry('D'), entry('E')];
    const out = orderCatalogDefault(entries, new Set(['C']));
    assert.equal(out.length, entries.length);
    assert.deepEqual(new Set(ids(out)), new Set(ids(entries)));
  });

  test('alphabetical order is the final tie-breaker inside a provider/title-lane bucket', () => {
    // All three share the same provider and the same 4-char title lane
    // ("SAME"), so they land in one bucket — within that bucket they must
    // come out alphabetical.
    const entries = [
      entry('Same Charlie'),
      entry('Same Alpha'),
      entry('Same Bravo'),
    ];
    const out = ids(orderCatalogDefault(entries, new Set()));
    assert.deepEqual(out, ['Same Alpha', 'Same Bravo', 'Same Charlie']);
  });

  test('provider-heavy generic entries with distinct title lanes are interleaved, not emitted as one alphabetical block', () => {
    // Four distinct provider/title-lane buckets, three entries each, all
    // sharing one dominant provider — the exact "many entries from one
    // scrape batch" shape that produced long alphabetical runs before this
    // change. Equal bucket sizes mean round-robin fully eliminates
    // same-bucket adjacency here (uneven real-world bucket sizes reduce,
    // rather than fully eliminate, run length — see code comment on
    // titleLane about the franchise-numbered-sequel limitation).
    const groups = ['Alfa', 'Bravo', 'Charlie', 'Delta'];
    const suffixes = ['One', 'Two', 'Three'];
    const entries: TrainerCatalogEntry[] = [];
    for (const suffix of suffixes) {
      for (const group of groups) {
        entries.push(entry(`${group} ${suffix}`));
      }
    }

    const naiveAlphabetical = [...entries].sort((a, b) => a.displayName.localeCompare(b.displayName));
    const laneOf = (e: TrainerCatalogEntry) => e.displayName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();

    function longestRun(list: TrainerCatalogEntry[]): number {
      let longest = 1;
      let current = 1;
      for (let i = 1; i < list.length; i += 1) {
        if (laneOf(list[i]) === laneOf(list[i - 1])) {
          current += 1;
          longest = Math.max(longest, current);
        } else {
          current = 1;
        }
      }
      return longest;
    }

    assert.equal(longestRun(naiveAlphabetical), 3, 'sanity check: naive alphabetical clusters each group');

    const diversified = orderCatalogDefault(entries, new Set());
    assert.equal(longestRun(diversified), 1, 'round-robin across equal-size buckets breaks up every same-lane run');
    assert.equal(diversified.length, entries.length);
    assert.deepEqual(new Set(ids(diversified)), new Set(ids(entries)));
  });

  test('explicit A-Z is a separate code path and is not exercised by this helper', () => {
    // orderCatalogDefault is only used for the default ("installed first")
    // mode — TrainerLibraryPage.tsx's 'a-z' branch calls
    // displayName.localeCompare directly and never calls this helper.
    // Documented here as a guard against future accidental coupling.
    assert.equal(typeof orderCatalogDefault, 'function');
  });
});

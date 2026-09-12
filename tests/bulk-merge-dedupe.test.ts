import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeNewTablesBySha256 } from '../scripts/lib/dedupe-ct-tables.mjs';

function table(sha256: string, archivePath: string) {
  return { archivePath, game: 'Game', tableName: archivePath, sourceSha256: sha256, sourceBytes: 1, counts: {}, cheats: [] };
}

describe('dedupeNewTablesBySha256 (bulk-merge-ct-repos.mjs dedup)', () => {
  test('CASE 1 — identical CT from a second repository is skipped', () => {
    const existing = [table('abc123', 'RepoA/Game.CT')];
    const incoming = [table('abc123', 'RepoB/Game.CT')];
    const result = dedupeNewTablesBySha256(existing, incoming);
    assert.deepEqual(result, []);
  });

  test('CASE 2 — same game, genuinely different CT contents is preserved', () => {
    const existing = [table('abc123', 'RepoA/Game.CT')];
    const incoming = [table('def456', 'RepoB/Game2.CT')];
    const result = dedupeNewTablesBySha256(existing, incoming);
    assert.deepEqual(result, incoming);
  });

  test('CASE 3 — same SHA256 under a different filename/path is skipped', () => {
    const existing = [table('abc123', 'RepoA/original-name.CT')];
    const incoming = [table('abc123', 'RepoB/totally-different-name.CT')];
    const result = dedupeNewTablesBySha256(existing, incoming);
    assert.deepEqual(result, []);
  });

  test('mixed batch: preserves only the genuinely new tables', () => {
    const existing = [table('abc123', 'RepoA/a.CT')];
    const incoming = [table('abc123', 'RepoB/a-renamed.CT'), table('zzz999', 'RepoB/b.CT')];
    const result = dedupeNewTablesBySha256(existing, incoming);
    assert.deepEqual(result, [table('zzz999', 'RepoB/b.CT')]);
  });

  test('no existing shard (brand-new game): nothing is filtered out', () => {
    const incoming = [table('abc123', 'RepoA/a.CT'), table('def456', 'RepoA/b.CT')];
    const result = dedupeNewTablesBySha256(undefined, incoming);
    assert.deepEqual(result, incoming);
  });

  test('does not mutate its inputs', () => {
    const existing = [table('abc123', 'RepoA/a.CT')];
    const incoming = [table('abc123', 'RepoB/a.CT'), table('def456', 'RepoB/b.CT')];
    const existingCopy = JSON.parse(JSON.stringify(existing));
    const incomingCopy = JSON.parse(JSON.stringify(incoming));
    dedupeNewTablesBySha256(existing, incoming);
    assert.deepEqual(existing, existingCopy);
    assert.deepEqual(incoming, incomingCopy);
  });
});

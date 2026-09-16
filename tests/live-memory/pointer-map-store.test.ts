// Phase 2 P2-2 — pointer-map persistence (ROADMAP §8/§9). Isolated from
// shared project data via resetForTesting() (:memory: sql.js), same
// convention as artwork-cache-store.test.ts.
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetForTesting } from '../../src/core/database/index.ts';
import {
  MAX_SERIALIZED_MAP_BYTES,
  deleteSavedPointerMap,
  listSavedPointerMaps,
  loadPointerMap,
  savePointerMap,
} from '../../src/core/live-memory/pointer-map-store.ts';
import {
  addPointerMapNode,
  createEmptyPointerMap,
  pointerMapNodeFromCandidate,
} from '../../src/core/live-memory/pointer-map.ts';
import type { PointerPathCandidate } from '../../src/core/live-memory/pointer-scanner.ts';

function candidate(): PointerPathCandidate {
  return { moduleName: 'game.exe', moduleOffset: 0x2000, offsets: [16], depth: 1 };
}

describe('pointer_maps store', () => {
  beforeAll(async () => {
    await resetForTesting();
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('round-trips a saved map and marks it inactive on load', () => {
    let map = createEmptyPointerMap('Gold Chain');
    const node = { ...pointerMapNodeFromCandidate('Gold', candidate()), status: 'resolved' as const, lastResolvedAddress: '0xdeadbeef' };
    map = addPointerMapNode(map, node);

    const saveResult = savePointerMap(map, { gameId: 'stardew-valley', executableIdentity: 'Stardew Valley.exe', architecture: 'x64' });
    assert.deepEqual(saveResult, { ok: true });

    const loaded = loadPointerMap(map.id);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    assert.equal(loaded.map.id, map.id);
    assert.equal(loaded.map.name, 'Gold Chain');
    assert.equal(loaded.map.nodes.length, 1);
    assert.deepEqual(loaded.map.nodes[0].path, node.path);
    // Reloaded nodes must never carry forward a pre-restart address as trusted current truth.
    assert.equal(loaded.map.nodes[0].status, 'unresolved');
    assert.equal(loaded.map.nodes[0].lastResolvedAddress, null);
  });

  test('loadPointerMap reports not_found for an unknown id', () => {
    const result = loadPointerMap('does-not-exist');
    assert.deepEqual(result, { ok: false, error: 'not_found' });
  });

  test('P2-4: a real schemaVersion=1 row (saved before pointer stability existed) migrates forward, not rejected', async () => {
    const db = (await import('../../src/core/database/index.ts')).default;
    // Deliberately the exact P2-2 shape — no `stability` field anywhere,
    // matching what a real pre-P2-4 save actually wrote to disk.
    const v1Map = {
      id: 'legacy-v1-map',
      name: 'Legacy P2-2 Map',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nodes: [
        {
          id: 'legacy-node-1',
          label: 'Legacy candidate',
          path: { moduleName: 'game.exe', moduleOffset: 0x2000, offsets: [16] },
          depth: 1,
          status: 'resolved',
          lastResolvedAddress: '0xdeadbeef',
          lastResolvedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          targetAddress: '0xdeadbeef',
          scanId: 'legacy-scan',
        },
      ],
    };
    db.prepare(
      `INSERT INTO pointer_maps (mapId, name, schemaVersion, gameId, executableIdentity, architecture, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(v1Map.id, v1Map.name, 1, null, null, null, JSON.stringify(v1Map), v1Map.createdAt, v1Map.updatedAt);

    const result = loadPointerMap(v1Map.id);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.map.nodes.length, 1);
    // Migration backfills a real, empty stability state — never fabricates
    // restart history that never happened, and never leaves it undefined
    // where downstream code would need its own null-check to be correct.
    assert.deepEqual(result.map.nodes[0].stability, { baseline: null, observations: [] });
    // The existing P2-2 stale-on-load guarantee still holds for migrated data too.
    assert.equal(result.map.nodes[0].status, 'unresolved');
    assert.equal(result.map.nodes[0].lastResolvedAddress, null);
  });

  test('P2-4: loadPointerMap rejects a corrupt stability field (mission §25) rather than crashing later code', async () => {
    const db = (await import('../../src/core/database/index.ts')).default;
    const corruptMap = {
      id: 'corrupt-stability-map',
      name: 'Corrupt Stability',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nodes: [
        {
          id: 'n1',
          label: 'Bad stability',
          path: { moduleName: 'game.exe', moduleOffset: 0, offsets: [16] },
          depth: 1,
          status: 'unresolved',
          lastResolvedAddress: null,
          lastResolvedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          targetAddress: null,
          scanId: null,
          // observations must be an array — a string here is corrupt data,
          // not a real stability state (e.g. from a hand-edited file).
          stability: { baseline: null, observations: 'not-an-array' },
        },
      ],
    };
    db.prepare(
      `INSERT INTO pointer_maps (mapId, name, schemaVersion, gameId, executableIdentity, architecture, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(corruptMap.id, corruptMap.name, 2, null, null, null, JSON.stringify(corruptMap), corruptMap.createdAt, corruptMap.updatedAt);

    const result = loadPointerMap(corruptMap.id);
    assert.deepEqual(result, { ok: false, error: 'corrupt' });
  });

  test('loadPointerMap rejects an unsupported future schema version', async () => {
    const db = (await import('../../src/core/database/index.ts')).default;
    const map = createEmptyPointerMap('Future Schema');
    db.prepare(
      `INSERT INTO pointer_maps (mapId, name, schemaVersion, gameId, executableIdentity, architecture, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(map.id, map.name, 999, null, null, null, JSON.stringify(map), map.createdAt, map.updatedAt);

    const result = loadPointerMap(map.id);
    assert.deepEqual(result, { ok: false, error: 'unsupported_schema_version' });
  });

  test('loadPointerMap rejects corrupt JSON without throwing', async () => {
    const db = (await import('../../src/core/database/index.ts')).default;
    db.prepare(
      `INSERT INTO pointer_maps (mapId, name, schemaVersion, gameId, executableIdentity, architecture, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('corrupt-map', 'Corrupt', 1, null, null, null, '{not valid json', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    const result = loadPointerMap('corrupt-map');
    assert.deepEqual(result, { ok: false, error: 'corrupt' });
  });

  test('loadPointerMap rejects a malformed chain (non-numeric offset) as corrupt', async () => {
    const db = (await import('../../src/core/database/index.ts')).default;
    const malformed = {
      id: 'malformed-map',
      name: 'Malformed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nodes: [
        {
          id: 'n1',
          label: 'Bad',
          path: { moduleName: 'game.exe', moduleOffset: 0, offsets: ['not-a-number'] },
          depth: 1,
          status: 'unresolved',
          lastResolvedAddress: null,
          lastResolvedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          targetAddress: null,
          scanId: null,
        },
      ],
    };
    db.prepare(
      `INSERT INTO pointer_maps (mapId, name, schemaVersion, gameId, executableIdentity, architecture, data, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('malformed-map', 'Malformed', 1, null, null, null, JSON.stringify(malformed), malformed.createdAt, malformed.updatedAt);

    const result = loadPointerMap('malformed-map');
    assert.deepEqual(result, { ok: false, error: 'corrupt' });
  });

  test('savePointerMap rejects an oversized map instead of truncating it', () => {
    let map = createEmptyPointerMap('Huge Map');
    // A single node's serialized JSON is well under 1 KB; padding the label
    // past the byte ceiling proves the guard fires on real size, not a stub.
    const oversizedLabel = 'x'.repeat(MAX_SERIALIZED_MAP_BYTES + 1);
    map = addPointerMapNode(map, { ...pointerMapNodeFromCandidate(oversizedLabel, candidate()) });

    const result = savePointerMap(map);
    assert.deepEqual(result, { ok: false, error: 'oversized' });
    assert.deepEqual(loadPointerMap(map.id), { ok: false, error: 'not_found' }, 'a rejected save must not partially persist');
  });

  test('listSavedPointerMaps and deleteSavedPointerMap round-trip metadata without full deserialization cost', () => {
    let mapA = createEmptyPointerMap('List Test A');
    mapA = addPointerMapNode(mapA, pointerMapNodeFromCandidate('N1', candidate()));
    let mapB = createEmptyPointerMap('List Test B');

    savePointerMap(mapA);
    savePointerMap(mapB);

    const listed = listSavedPointerMaps();
    const a = listed.find((m) => m.mapId === mapA.id);
    const b = listed.find((m) => m.mapId === mapB.id);
    assert.equal(a?.nodeCount, 1);
    assert.equal(b?.nodeCount, 0);

    deleteSavedPointerMap(mapA.id);
    assert.deepEqual(loadPointerMap(mapA.id), { ok: false, error: 'not_found' });
    assert.equal(loadPointerMap(mapB.id).ok, true, 'deleting one map must not affect another');
  });

  test('savePointerMap upserts in place on a repeated save (no duplicate rows)', () => {
    let map = createEmptyPointerMap('Upsert Test');
    savePointerMap(map);
    const renamed = { ...map, name: 'Upsert Test Renamed', updatedAt: new Date().toISOString() };
    savePointerMap(renamed);

    const listed = listSavedPointerMaps().filter((m) => m.mapId === map.id);
    assert.equal(listed.length, 1, 'a repeated save must update the existing row, not insert a second one');
    assert.equal(listed[0].name, 'Upsert Test Renamed');
  });
});

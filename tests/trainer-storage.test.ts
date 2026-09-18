import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import db, { resetForTesting, closeDatabaseSafely, flushPersistence } from '../src/core/database/index.js';
import { upsertDefinitionPayload, listModPackRowsForGame } from '../src/core/trainer-catalog/store.js';
import {
  getCanonicalTrainerDefinition,
  listCanonicalTrainerDefinitions,
  persistTrainerDefinition,
  removeCanonicalTrainerDefinition,
} from '../src/core/trainer-storage/repository.js';
import { pickPreferredRow, sourcePriorityRank, sourceTypeForProvider } from '../src/core/trainer-storage/source-priority.js';
import { validateSolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import { TrainerRuntime } from '../src/core/trainer-runtime/runtime.js';
import { FakeTrainerRuntimeCapabilities } from './fixtures/fake-trainer-runtime-capabilities.js';

let uid = 0;
function gameId(label: string): string {
  uid += 1;
  return `p48-${label}-${Date.now()}-${uid}`;
}

function definitionFor(id: string): SolithDefinitionV1 {
  return {
    schemaVersion: 1,
    id,
    title: `Test Game ${id}`,
    gameVersion: '*',
    executableHashPrefixes: [],
    author: 'test',
    safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
    target: { executables: ['Demo.exe'], arch: 'x64' },
    memoryFeatures: [
      {
        id: 'gold',
        name: 'Gold',
        category: 'Currency',
        type: 'toggle',
        dataType: 'int32',
        defaultValue: 9999,
        resolution: { moduleName: 'Demo.exe', baseOffset: '0x1000' },
      },
    ],
  };
}

function legacyModPackFor(id: string, sourceProvider: string): Record<string, unknown> {
  return {
    packId: `${id}-pack-legacy`,
    catalogGameId: id,
    gameName: `Legacy ${id}`,
    source: { provider: sourceProvider },
    verificationStatus: 'community',
    versions: [{ versionLabel: '*', executables: ['Demo.exe'] }],
    cheats: [
      {
        id: 'ammo',
        name: 'Ammo',
        description: 'legacy cheat',
        category: 'Combat',
        valueType: 'int32',
        requiresDiscovery: false,
        verified: false,
        pointerPath: { moduleName: 'Demo.exe', moduleOffset: 0x2000, offsets: [] },
        defaultValue: 999,
      },
    ],
    connectionBaseline: 0,
    platform: 'unknown',
    syncedAt: new Date(0).toISOString(),
  };
}

describe('P4-8: canonical trainer-definition persistence', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  before(async () => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p48-test-'));
    tempDbPath = path.join(tempDbDir, 'test-trainer-storage.sqlite');
    await resetForTesting(tempDbPath);
    await flushPersistence();
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDbDir)) fs.rmSync(tempDbDir, { recursive: true, force: true });
  });

  describe('canonical repository', () => {
    test('1/2. save then load a V1 canonical definition', () => {
      const id = gameId('save-load');
      const def = definitionFor(id);
      const saved = persistTrainerDefinition(def, { sourceProvider: 'user' });
      assert.equal(saved.success, true);
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.definition.title, def.title);
    });

    test('3. stable trainer ID preserved', () => {
      const id = gameId('stable-id');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.catalogGameId, id);
      assert.equal(loaded.value.definition.id, id);
    });

    test('4. feature/action IDs preserved', () => {
      const id = gameId('feature-ids');
      const def = definitionFor(id);
      persistTrainerDefinition(def, { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.deepEqual(
        loaded.value.definition.memoryFeatures?.map((f) => f.id),
        def.memoryFeatures?.map((f) => f.id),
      );
    });

    test('5. list returns canonical definitions only', () => {
      const idA = gameId('list-a');
      const idB = gameId('list-b');
      persistTrainerDefinition(definitionFor(idA), { sourceProvider: 'user' });
      upsertDefinitionPayload(`${idB}-pack`, idB, JSON.stringify(legacyModPackFor(idB, 'bundled')), 'community', 'bundled', new Date().toISOString());
      const listed = listCanonicalTrainerDefinitions();
      assert.equal(listed.success, true);
      if (!listed.success) return;
      const found = listed.value.records.filter((r) => r.catalogGameId === idA || r.catalogGameId === idB);
      assert.equal(found.length, 2);
      for (const record of found) {
        assert.equal(record.definition.schemaVersion, 1);
      }
    });
  });

  describe('legacy read', () => {
    test('6/9. legacy/unversioned ModPack record migrates on read into canonical representation', () => {
      const id = gameId('legacy-migrate');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(legacyModPackFor(id, 'bundled')), 'community', 'bundled', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.definition.schemaVersion, 1);
      assert.ok(loaded.value.definition.memoryFeatures && loaded.value.definition.memoryFeatures.length > 0);
      assert.equal(loaded.value.provenance.migratedFromLegacy, true);
    });

    test('7. migration result validates', () => {
      const id = gameId('legacy-validates');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(legacyModPackFor(id, 'user')), 'community', 'user', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.deepEqual(validateSolithDefinitionV1(loaded.value.definition), []);
    });

    test('8. legacy source row is not rewritten by a read', () => {
      const id = gameId('legacy-readonly');
      const rawJson = JSON.stringify(legacyModPackFor(id, 'bundled'));
      upsertDefinitionPayload(`${id}-pack`, id, rawJson, 'community', 'bundled', new Date().toISOString());
      getCanonicalTrainerDefinition(id); // read only
      const rows = listModPackRowsForGame(id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].payloadJson, rawJson);
    });
  });

  describe('future version', () => {
    test('10. unsupported future version rejected', () => {
      const id = gameId('future-version');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify({ ...definitionFor(id), schemaVersion: 999 }), 'community', 'user', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, false);
      if (loaded.success) return;
      assert.equal(loaded.error.reason, 'UNSUPPORTED_SCHEMA_VERSION');
    });

    test('11. one bad record does not crash the whole list', () => {
      const badId = gameId('list-bad');
      const goodId = gameId('list-good');
      upsertDefinitionPayload(`${badId}-pack`, badId, JSON.stringify({ ...definitionFor(badId), schemaVersion: 999 }), 'community', 'user', new Date().toISOString());
      persistTrainerDefinition(definitionFor(goodId), { sourceProvider: 'user' });
      const listed = listCanonicalTrainerDefinitions();
      assert.equal(listed.success, true);
      if (!listed.success) return;
      assert.ok(listed.value.failures.some((f) => f.catalogGameId === badId && f.error.reason === 'UNSUPPORTED_SCHEMA_VERSION'));
      assert.ok(listed.value.records.some((r) => r.catalogGameId === goodId));
    });
  });

  describe('corrupt data', () => {
    test('12. malformed JSON explicit failure', () => {
      const id = gameId('malformed-json');
      db.prepare(
        `INSERT INTO trainer_mod_packs (packId, catalogGameId, payloadJson, verificationStatus, sourceProvider, syncedAt, cert_level, updated_at, updatedAt)
         VALUES (?, ?, ?, 'community', 'user', ?, 'L0_Community', 0, datetime('now'))`,
      ).run(`${id}-pack`, id, '{not valid json', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, false);
      if (loaded.success) return;
      assert.equal(loaded.error.reason, 'INVALID_PAYLOAD');
    });

    test('13. malformed schema (versioned but invalid) explicit failure', () => {
      const id = gameId('malformed-schema');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify({ schemaVersion: 1, id }), 'community', 'user', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, false);
      if (loaded.success) return;
      assert.equal(loaded.error.reason, 'VALIDATION_FAILED');
    });

    test('14. migration failure (legacy-shaped but invalid) explicit', () => {
      const id = gameId('legacy-invalid');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify({ notACatalogGameId: true }), 'community', 'user', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, false);
      if (loaded.success) return;
      assert.equal(loaded.error.reason, 'INVALID_PAYLOAD');
    });
  });

  describe('writes', () => {
    test('15/16. canonical write validates before persistence — invalid object never written', () => {
      const id = gameId('invalid-write');
      const result = persistTrainerDefinition({ schemaVersion: 1, id }, { sourceProvider: 'user' });
      assert.equal(result.success, false);
      const rows = listModPackRowsForGame(id);
      assert.equal(rows.length, 0);
    });

    test('17. transaction rolls back on a mid-write persistence failure', () => {
      const id = gameId('rollback');
      const originalPrepare = db.prepare.bind(db);
      let shouldFail = true;
      // @ts-expect-error — test-only override of the DB singleton's prepare method to force a write failure.
      db.prepare = (sql: string) => {
        if (shouldFail && sql.includes('INSERT INTO trainer_mod_packs')) {
          throw new Error('simulated write failure');
        }
        return originalPrepare(sql);
      };
      try {
        const result = persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
        assert.equal(result.success, false);
        if (!result.success) assert.equal(result.error.reason, 'STORAGE_WRITE_FAILED');
      } finally {
        db.prepare = originalPrepare;
        shouldFail = false;
      }
      // Rollback must have actually happened at the SQL level — no row exists.
      const rows = listModPackRowsForGame(id);
      assert.equal(rows.length, 0);
    });

    test('18. read-back verification succeeds on a normal save', () => {
      const id = gameId('verify-ok');
      const saved = persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      assert.equal(saved.success, true);
      if (!saved.success) return;
      const reloaded = getCanonicalTrainerDefinition(id);
      assert.equal(reloaded.success, true);
      if (!reloaded.success) return;
      assert.equal(saved.value.packId, reloaded.value.packId);
    });

    test('19. read-back mismatch surfaces VERIFY_FAILED', () => {
      const id = gameId('verify-mismatch');
      const originalPrepare = db.prepare.bind(db);
      // @ts-expect-error — test-only override to corrupt the read-back query's result.
      db.prepare = (sql: string) => {
        const real = originalPrepare(sql);
        if (sql.includes('SELECT packId, catalogGameId, payloadJson') && sql.includes('FROM trainer_mod_packs')) {
          const originalAll = real.all.bind(real);
          real.all = (...params: unknown[]) => {
            const rows = originalAll(...params);
            return rows.map((row: Record<string, unknown>) =>
              row.catalogGameId === id ? { ...row, payloadJson: 'not json after all' } : row,
            );
          };
        }
        return real;
      };
      try {
        const result = persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
        assert.equal(result.success, false);
        if (!result.success) assert.equal(result.error.reason, 'VERIFY_FAILED');
      } finally {
        db.prepare = originalPrepare;
      }
    });
  });

  describe('provenance', () => {
    test('20. source provenance retained', () => {
      const id = gameId('provenance-source');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'ct-import', sourceId: 'sha256:abc123' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.provenance.sourceProvider, 'ct-import');
      assert.equal(loaded.value.provenance.sourceId, 'sha256:abc123');
      assert.equal(loaded.value.provenance.sourceType, 'ct_import');
    });

    test('21. migration provenance retained where designed', () => {
      const legacyId = gameId('provenance-legacy');
      const nativeId = gameId('provenance-native');
      upsertDefinitionPayload(`${legacyId}-pack`, legacyId, JSON.stringify(legacyModPackFor(legacyId, 'user')), 'community', 'user', new Date().toISOString());
      persistTrainerDefinition(definitionFor(nativeId), { sourceProvider: 'user' });
      const legacy = getCanonicalTrainerDefinition(legacyId);
      const native = getCanonicalTrainerDefinition(nativeId);
      assert.equal(legacy.success && legacy.value.provenance.migratedFromLegacy, true);
      assert.equal(native.success && native.value.provenance.migratedFromLegacy, false);
    });

    test('22. certification metadata not inflated for a user-sourced save', () => {
      const id = gameId('cert-not-inflated');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.provenance.certLevel, 'L0_Community');
    });
  });

  describe('certification convergence', () => {
    test('23. bundled source maps to L3_Certified', () => {
      const id = gameId('cert-bundled');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'verified', 'bundled', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.provenance.certLevel, 'L3_Certified');
    });

    test('24. unknown/community provider does not become certified', () => {
      const id = gameId('cert-unknown');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'community', 'some-unlisted-provider', new Date().toISOString());
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.provenance.certLevel, 'L0_Community');
    });
  });

  describe('timestamp convergence', () => {
    test('25. canonical updatedAt timestamp round-trips', () => {
      const id = gameId('ts-updated-at');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.ok(!Number.isNaN(new Date(loaded.value.provenance.updatedAt).getTime()));
    });

    test('26. legacy syncedAt is preserved distinctly', () => {
      const id = gameId('ts-synced-at');
      const syncedAt = '2020-06-15T00:00:00.000Z';
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'community', 'user', syncedAt);
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.provenance.syncedAt, syncedAt);
    });

    test('27. syncedAt and updatedAt do not collapse into one field', () => {
      const id = gameId('ts-distinct');
      const syncedAt = '2019-01-01T00:00:00.000Z';
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'community', 'user', syncedAt);
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.notEqual(loaded.value.provenance.syncedAt, loaded.value.provenance.updatedAt);
    });
  });

  describe('conflict handling', () => {
    test('28. canonical-vs-bundled conflict resolves deterministically', () => {
      const id = gameId('conflict-deterministic');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'verified', 'bundled', '2020-01-01T00:00:00.000Z');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const first = getCanonicalTrainerDefinition(id);
      const second = getCanonicalTrainerDefinition(id);
      assert.equal(first.success, true);
      assert.equal(second.success, true);
      if (!first.success || !second.success) return;
      assert.equal(first.value.provenance.sourceProvider, 'user');
      assert.equal(first.value.packId, second.value.packId);
    });

    test('29. losing source is explicit in provenance.conflictingSources', () => {
      const id = gameId('conflict-explicit');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'verified', 'bundled', '2020-01-01T00:00:00.000Z');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.ok(loaded.value.provenance.conflictingSources.some((c) => c.sourceProvider === 'bundled'));
    });

    test('30. saving a user override does not delete the pre-existing bundled row', () => {
      const id = gameId('conflict-no-overwrite');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(definitionFor(id)), 'verified', 'bundled', '2020-01-01T00:00:00.000Z');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const rows = listModPackRowsForGame(id);
      assert.equal(rows.length, 2);
      assert.ok(rows.some((r) => r.sourceProvider === 'bundled'));
      assert.ok(rows.some((r) => r.sourceProvider === 'user'));
    });

    test('source-priority pure function: user beats bundled', () => {
      assert.ok(sourcePriorityRank('user') < sourcePriorityRank('bundled'));
      assert.equal(sourceTypeForProvider('bundled'), 'bundled');
      const picked = pickPreferredRow([
        { packId: 'a', catalogGameId: 'x', payloadJson: '{}', verificationStatus: 'community', sourceProvider: 'bundled', syncedAt: '2020-01-01', certLevel: 'L3_Certified', updatedAt: '', sourceId: null },
        { packId: 'b', catalogGameId: 'x', payloadJson: '{}', verificationStatus: 'community', sourceProvider: 'user', syncedAt: '2019-01-01', certLevel: 'L0_Community', updatedAt: '', sourceId: null },
      ]);
      assert.equal(picked.winner.packId, 'b');
      assert.equal(picked.conflicts.length, 1);
    });
  });

  describe('separation', () => {
    test('31. definition content never carries runtime-state fields', () => {
      const id = gameId('separation-runtime');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      const serialized = JSON.stringify(loaded.value.definition);
      for (const forbidden of ['"currentPid"', '"resolvedAddress"', '"rollbackReference"', '"freezeWorker"', '"lifecycleState"']) {
        assert.ok(!serialized.includes(forbidden));
      }
    });

    test('32/33. trainer-storage module never touches cheat-toggle or Phase 2 watchlist tables', async () => {
      const fsp = await import('node:fs/promises');
      const files = ['repository.ts', 'types.ts', 'source-priority.ts', 'errors.ts', 'index.ts'];
      for (const file of files) {
        const source = await fsp.readFile(new URL(`../src/core/trainer-storage/${file}`, import.meta.url), 'utf8');
        assert.ok(!source.includes('cheat_toggle_state'));
        assert.ok(!source.includes('watchlist'));
        assert.ok(!source.includes('memory-map'));
      }
    });
  });

  describe('compatibility', () => {
    test('34. loadCatalogDefinition still returns a working definition for legacy input', async () => {
      const id = gameId('compat-load-catalog');
      upsertDefinitionPayload(`${id}-pack`, id, JSON.stringify(legacyModPackFor(id, 'bundled')), 'community', 'bundled', new Date().toISOString());
      const { loadCatalogDefinition } = await import('../src/core/definitions/load-catalog-definition.js');
      const definition = loadCatalogDefinition(id);
      assert.ok(definition);
      assert.equal(definition?.schemaVersion, 1);
    });

    test('35. P4-5 TrainerRuntime loads a repository-returned canonical definition', () => {
      const id = gameId('compat-runtime');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
      const result = runtime.load(loaded.value.definition);
      assert.equal(result.success, true);
      assert.equal(runtime.getState(), 'LOADED');
    });
  });

  describe('remove', () => {
    test('remove deletes all persisted rows for a game', () => {
      const id = gameId('remove');
      persistTrainerDefinition(definitionFor(id), { sourceProvider: 'user' });
      const removed = removeCanonicalTrainerDefinition(id);
      assert.equal(removed.success, true);
      const loaded = getCanonicalTrainerDefinition(id);
      assert.equal(loaded.success, false);
      if (loaded.success) return;
      assert.equal(loaded.error.reason, 'NOT_FOUND');
    });

    test('remove on a non-existent game reports NOT_FOUND', () => {
      const id = gameId('remove-missing');
      const removed = removeCanonicalTrainerDefinition(id);
      assert.equal(removed.success, false);
      if (removed.success) return;
      assert.equal(removed.error.reason, 'NOT_FOUND');
    });
  });
});

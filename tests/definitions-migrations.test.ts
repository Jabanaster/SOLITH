import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateTrainerDefinition,
  detectTrainerDefinitionVersion,
  LEGACY_UNVERSIONED,
} from '../src/core/definitions/migrations/index.js';
import { validateSolithDefinitionV1, type SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import {
  isSolithDefinitionPayload,
  solithDefinitionToModPack,
} from '../src/core/definitions/mod-pack-adapter.js';
import { bundledDefinitionsForTests } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import type { ModPack } from '../src/core/trainer-catalog/types.js';

const MINIMAL_V1: SolithDefinitionV1 = {
  schemaVersion: 1,
  id: 'demo-game',
  title: 'Demo Game',
  gameVersion: '*',
  executableHashPrefixes: [],
  author: 'test',
  safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
  target: { executables: ['Demo.exe'], arch: 'x64' },
};

const MINIMAL_MODPACK: ModPack = {
  packId: 'demo-pack',
  catalogGameId: 'demo-game',
  gameName: 'Demo Game',
  source: { provider: 'user' },
  verificationStatus: 'community',
  versions: [{ versionLabel: '*', executables: ['Demo.exe'] }],
  cheats: [
    {
      id: 'c1',
      name: 'Cheat One',
      description: 'desc',
      category: 'General',
      valueType: 'int32',
      requiresDiscovery: false,
      verified: false,
      pointerPath: { moduleName: 'Demo.exe', moduleOffset: 0x100, offsets: [] },
    },
    {
      id: 'c2',
      name: 'Infinite Health',
      description: 'desc',
      category: 'General',
      valueType: 'int32',
      requiresDiscovery: false,
      verified: false,
      infiniteValue: 999,
      pointerPath: { moduleName: 'Demo.exe', moduleOffset: 0x200, offsets: [4] },
    },
  ],
  connectionBaseline: 0,
  platform: 'unknown',
  syncedAt: new Date(0).toISOString(),
};

describe('version detection', () => {
  test('valid current V1 is detected as versioned/1', () => {
    const detected = detectTrainerDefinitionVersion(MINIMAL_V1);
    assert.deepEqual(detected, { kind: 'versioned', version: 1 });
  });

  test('legacy/unversioned input is recognized', () => {
    const detected = detectTrainerDefinitionVersion(MINIMAL_MODPACK);
    assert.deepEqual(detected, { kind: 'legacy_unversioned' });
  });

  test('unknown future version is rejected, not guessed', () => {
    const detected = detectTrainerDefinitionVersion({ ...MINIMAL_V1, schemaVersion: 999 });
    assert.deepEqual(detected, { kind: 'unknown_future_version', version: 999 });
  });

  test('malformed schemaVersion is rejected', () => {
    assert.equal(detectTrainerDefinitionVersion({ schemaVersion: 'abc' }).kind, 'malformed');
    assert.equal(detectTrainerDefinitionVersion({ schemaVersion: -1 }).kind, 'malformed');
    assert.equal(detectTrainerDefinitionVersion({ schemaVersion: 1.5 }).kind, 'malformed');
    assert.equal(detectTrainerDefinitionVersion({ schemaVersion: null }).kind, 'malformed');
    assert.equal(detectTrainerDefinitionVersion(null).kind, 'malformed');
    assert.equal(detectTrainerDefinitionVersion([1, 2, 3]).kind, 'malformed');
    assert.equal(detectTrainerDefinitionVersion('not-an-object').kind, 'malformed');
  });
});

describe('migrateTrainerDefinition', () => {
  test('current V1 input requires no migration', () => {
    const result = migrateTrainerDefinition(MINIMAL_V1);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.sourceVersion, 1);
    assert.equal(result.targetVersion, 1);
    assert.deepEqual(result.migrationsApplied, []);
  });

  test('legacy ModPack input migrates to V1', () => {
    const result = migrateTrainerDefinition(MINIMAL_MODPACK);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.sourceVersion, LEGACY_UNVERSIONED);
    assert.equal(result.targetVersion, 1);
    assert.equal(result.definition.schemaVersion, 1);
    assert.equal(validateSolithDefinitionV1(result.definition).length, 0);
  });

  test('migration reports the step(s) that ran', () => {
    const result = migrateTrainerDefinition(MINIMAL_MODPACK);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.migrationsApplied.length, 1);
    assert.equal(result.migrationsApplied[0]?.id, 'legacy-unversioned-to-v1');
    assert.equal(result.migrationsApplied[0]?.from, LEGACY_UNVERSIONED);
    assert.equal(result.migrationsApplied[0]?.to, 1);
  });

  test('migration is deterministic', () => {
    const first = migrateTrainerDefinition(MINIMAL_MODPACK);
    const second = migrateTrainerDefinition(MINIMAL_MODPACK);
    assert.deepEqual(first, second);
  });

  test('migration does not mutate the source object', () => {
    const clone = JSON.parse(JSON.stringify(MINIMAL_MODPACK));
    migrateTrainerDefinition(MINIMAL_MODPACK);
    assert.deepEqual(MINIMAL_MODPACK, clone);
  });

  test('unknown future version fails closed with a typed, actionable error', () => {
    const result = migrateTrainerDefinition({ ...MINIMAL_V1, schemaVersion: 999 });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.reason, 'UNKNOWN_FUTURE_VERSION');
    assert.match(result.errors[0] ?? '', /unsupported schema version/i);
  });

  test('malformed legacy input is rejected, not crashed on', () => {
    const result = migrateTrainerDefinition({ notAModPackOrDefinition: true });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.reason, 'LEGACY_INPUT_INVALID');
    assert.ok(result.errors.length > 0);
  });
});

describe('P4-2 compatibility — existing V1 content must remain valid', () => {
  test('every bundled definition migrates cleanly with no migration steps', () => {
    for (const definition of bundledDefinitionsForTests()) {
      const result = migrateTrainerDefinition(definition);
      assert.equal(result.success, true, `bundled definition ${definition.id} failed migration`);
      if (!result.success) continue;
      assert.equal(result.sourceVersion, 1);
      assert.equal(result.migrationsApplied.length, 0);
      assert.equal(result.definition.id, definition.id);
    }
  });

  test('ModPack conversion still functions end-to-end through the migration pipeline', () => {
    const result = migrateTrainerDefinition(MINIMAL_MODPACK);
    assert.equal(result.success, true);
    if (!result.success) return;

    // IDs preserved.
    assert.equal(result.definition.id, MINIMAL_MODPACK.catalogGameId);

    // Action semantics preserved: one plain cheat -> toggle, one infiniteValue cheat -> freeze.
    const types = (result.definition.memoryFeatures ?? []).map((f) => f.type).sort();
    assert.deepEqual(types, ['freeze', 'toggle']);

    // Target semantics preserved.
    assert.deepEqual(result.definition.target.executables, ['Demo.exe']);

    // isSolithDefinitionPayload correctly distinguishes the migrated output from the legacy input.
    assert.equal(isSolithDefinitionPayload(MINIMAL_MODPACK), false);
    assert.equal(isSolithDefinitionPayload(result.definition), true);
  });
});

describe('round-trip coverage', () => {
  test('canonical JSON round trip is lossless', () => {
    const reparsed = JSON.parse(JSON.stringify(MINIMAL_V1));
    const result = migrateTrainerDefinition(reparsed);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(result.definition, MINIMAL_V1);
  });

  test('ModPack external-format round trip is lossy and the loss is documented, not asserted away', () => {
    const migrated = migrateTrainerDefinition(MINIMAL_MODPACK);
    assert.equal(migrated.success, true);
    if (!migrated.success) return;

    const roundTripped = solithDefinitionToModPack(migrated.definition);

    // Known-lossy: ModPack fabricates verified/tags/platform fields that do not exist
    // on the canonical definition, so the pack is not identical to a "real" ModPack.
    assert.equal(roundTripped.cheats[0]?.verified, false);
    assert.deepEqual(roundTripped.cheats[0]?.tags, ['schema-v1']);
    assert.equal(roundTripped.platform, 'unknown');
    assert.notDeepEqual(roundTripped, MINIMAL_MODPACK);

    // What IS preserved across the round trip: identity and core action semantics.
    assert.equal(roundTripped.catalogGameId, MINIMAL_MODPACK.catalogGameId);
    assert.equal(roundTripped.cheats.length, MINIMAL_MODPACK.cheats.length);
  });
});

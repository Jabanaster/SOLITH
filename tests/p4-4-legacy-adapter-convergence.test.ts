import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resetForTesting, closeDatabaseSafely, flushPersistence } from '../src/core/database/index.js';
import { persistTrainerDefinition, getCanonicalTrainerDefinition } from '../src/core/trainer-storage/repository.js';
import { remoteTrainerToModPack } from '../src/core/trainer-catalog/sync/remote-sync.js';
import { modPackToSolithDefinition, modPackConversionLosses } from '../src/core/definitions/mod-pack-adapter.js';
import { getModPackForGame, upsertDefinitionPayload, upsertModPack } from '../src/core/trainer-catalog/store.js';
import { ALL_GAMES } from '../src/core/cheat-system/games.js';
import { cheatsForHotkeySlots } from '../src/core/cheat-system/cheat-hotkey-slots.js';
import { bundledDefinitionsForTests } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import { profileControlToTrainerControl } from '../src/core/game-profiles/transform.js';
import { recipeToSaveFieldFeature, recipesToSaveFieldFeatures } from '../src/core/recipes/canonical-adapter.js';
import { solithDefinitionToTrainerControls } from '../src/core/definitions/definition-to-trainer-controls.js';
import { setSetting } from '../src/core/settings/index.js';
import { syncCommunityDefinitions } from '../src/core/trainer-catalog/sync/hub-client.js';
import type { ParsedRemoteTrainer } from '../src/core/trainer-catalog/sync/parse-html.js';
import type { Recipe } from '../src/shared/types/index.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';

let uid = 0;
function gameId(label: string): string {
  uid += 1;
  return `p44-${label}-${Date.now()}-${uid}`;
}

describe('P4-4: legacy adapter convergence', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  before(async () => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p44-test-'));
    tempDbPath = path.join(tempDbDir, 'test-p4-4.sqlite');
    await resetForTesting(tempDbPath);
    await flushPersistence();
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDbDir)) fs.rmSync(tempDbDir, { recursive: true, force: true });
  });

  describe('ModPack sync write path (§5) — converges onto canonical persistence', () => {
    test('a community-sync ModPack is compiled through schema.v1 and persisted via persistTrainerDefinition, not a raw JSON row', () => {
      const id = gameId('sync');
      const trainer: ParsedRemoteTrainer = { title: 'Test Trainer', gameName: id, sourceUrl: 'https://example.test/trainer' };
      const pack = remoteTrainerToModPack(trainer, 'fling');
      const definition = modPackToSolithDefinition({ ...pack, catalogGameId: id });

      const persisted = persistTrainerDefinition(definition, { sourceProvider: 'fling', sourceId: trainer.sourceUrl });
      assert.equal(persisted.success, true);
      if (!persisted.success) return;

      // Stable ID mapping (mission §21 test 2): the ModPack's catalogGameId
      // becomes the canonical definition's id, unchanged.
      assert.equal(persisted.value.definition.id, id);
      // Source-suffixed packId convention (mission §5/§21 test 1) — never the
      // opaque legacy `${provider}-${catalogGameId}` scheme.
      assert.equal(persisted.value.packId, `${id}-pack-fling`);
      // No certification inflation (mission §13/§21 test 4): a community
      // listing's placeholder cheats never become verified/certified.
      assert.equal(persisted.value.definition.safety.verificationStatus, 'community');

      // Read back via the canonical repository — proves this is a real,
      // migrateable schema.v1 row, not a payload only migrate-on-read could
      // previously paper over.
      const canonical = getCanonicalTrainerDefinition(id);
      assert.equal(canonical.success, true);
      if (!canonical.success) return;
      assert.equal(canonical.value.provenance.sourceProvider, 'fling');
      assert.equal(canonical.value.provenance.sourceType, 'community_listing');
    });

    test('lossy ModPack fields are explicitly reportable, not silently dropped (mission §21 test 3)', () => {
      const trainer: ParsedRemoteTrainer = { title: 'Lossy Test Trainer', gameName: gameId('lossy'), sourceUrl: 'https://example.test/lossy' };
      const pack = remoteTrainerToModPack(trainer, 'mrantifun');
      // remoteTrainerToModPack's placeholder cheats always carry a description
      // and requiresDiscovery — description has no MemoryFeatureV1 field.
      const losses = modPackConversionLosses(pack);
      assert.ok(losses.includes('cheats[].description'));
    });

    test('P4-13 §20: lossy ModPack fields reach provenance.conversionWarnings through the real conversion+persistence path, not just modPackConversionLosses() in isolation', () => {
      const id = gameId('lossy-persisted');
      const trainer: ParsedRemoteTrainer = { title: 'Lossy Persisted Trainer', gameName: id, sourceUrl: 'https://example.test/lossy-persisted' };
      const pack = remoteTrainerToModPack(trainer, 'fling');
      const definition = modPackToSolithDefinition({ ...pack, catalogGameId: id });
      const conversionWarnings = modPackConversionLosses(pack);
      assert.ok(conversionWarnings.includes('cheats[].description'));

      // Real conversion (modPackToSolithDefinition) + real persistence
      // (persistTrainerDefinition), exactly as trainer-catalog/sync/index.ts
      // does it — this is the write-path half of the P4-13 §20 fix.
      const persisted = persistTrainerDefinition(definition, {
        sourceProvider: 'fling',
        sourceId: trainer.sourceUrl,
        conversionWarnings,
      });
      assert.equal(persisted.success, true);
      if (!persisted.success) return;
      assert.ok(persisted.value.provenance.conversionWarnings?.includes('cheats[].description'));
    });

    test('P4-13 §20: legacy-unversioned rows re-derive conversionWarnings on every read (no persistence gap)', () => {
      const id = gameId('lossy-legacy');
      const trainer: ParsedRemoteTrainer = { title: 'Lossy Legacy Trainer', gameName: id, sourceUrl: 'https://example.test/lossy-legacy' };
      const pack = { ...remoteTrainerToModPack(trainer, 'mrantifun'), catalogGameId: id };

      // Bypasses the canonical schema.v1 conversion entirely — a raw,
      // unversioned ModPack row, exactly like a historical
      // pre-P4-2 write (store.ts's upsertModPack()).
      upsertModPack(pack);

      const canonical = getCanonicalTrainerDefinition(id);
      assert.equal(canonical.success, true);
      if (!canonical.success) return;
      assert.equal(canonical.value.provenance.migratedFromLegacy, true);
      assert.ok(canonical.value.provenance.conversionWarnings?.includes('cheats[].description'));

      // Read it a second, fully independent time — proves this is
      // recomputed fresh from the still-raw stored JSON every read, not a
      // one-shot value that only survived because it was the same call.
      const canonicalAgain = getCanonicalTrainerDefinition(id);
      assert.equal(canonicalAgain.success, true);
      if (!canonicalAgain.success) return;
      assert.ok(canonicalAgain.value.provenance.conversionWarnings?.includes('cheats[].description'));
    });

    test('canonical -> ModPack compatibility export remains functional (mission §21 test 5)', () => {
      const id = gameId('export');
      const definition = modPackToSolithDefinition({
        ...remoteTrainerToModPack({ title: 'Export Test', gameName: id, sourceUrl: 'https://example.test/export' }, 'plitch'),
        catalogGameId: id,
      });
      const persisted = persistTrainerDefinition(definition, { sourceProvider: 'plitch' });
      assert.equal(persisted.success, true);
      if (!persisted.success) return;

      const modPack = getModPackForGame(id);
      assert.ok(modPack);
      assert.equal(modPack?.catalogGameId, id);
      assert.ok(modPack!.cheats.length > 0);
    });
  });

  describe('getModPackForGame conflict resolution (§5) — no longer naive syncedAt LIMIT 1', () => {
    test('a user-authored row outranks a later-synced community row, matching canonical source-priority', () => {
      const id = gameId('conflict');
      // Community row synced LATER (would win under the old naive
      // `ORDER BY syncedAt DESC LIMIT 1`).
      upsertDefinitionPayload(
        `${id}-pack-fling`,
        id,
        JSON.stringify({
          schemaVersion: 1,
          id,
          title: 'Community Version',
          gameVersion: '*',
          executableHashPrefixes: [],
          author: 'fling',
          safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
          target: { executables: ['Demo.exe'], arch: 'x64' },
          memoryFeatures: [],
        }),
        'community',
        'fling',
        '2026-09-17T12:00:00.000Z',
      );
      // User row synced EARLIER, but higher source-priority.
      upsertDefinitionPayload(
        `${id}-pack-user`,
        id,
        JSON.stringify({
          schemaVersion: 1,
          id,
          title: 'User Version',
          gameVersion: '*',
          executableHashPrefixes: [],
          author: 'user',
          safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
          target: { executables: ['Demo.exe'], arch: 'x64' },
          memoryFeatures: [],
        }),
        'community',
        'user',
        '2026-09-17T09:00:00.000Z',
      );

      const modPack = getModPackForGame(id);
      assert.equal(modPack?.gameName, 'User Version');
    });
  });

  describe('GameConfig/CheatDefinition canonical control projection (§6, mission tests 6-10)', () => {
    test('every hotkey-slot-addressable cheat id has a matching canonical MemoryFeatureV1 id in the bundled definition for its game', () => {
      const bundled = bundledDefinitionsForTests();
      const memoryGames = ALL_GAMES.filter(
        (g) => (g.cheatDiscoveryType === 'memory-scan' || g.cheatDiscoveryType === 'hybrid') && g.gameId !== 'avowed',
      );
      assert.ok(memoryGames.length > 0);

      for (const game of memoryGames) {
        const canonicalDef = bundled.find((d) => d.id === game.gameId);
        assert.ok(canonicalDef, `bundled definition must exist for ${game.gameId}`);
        const canonicalIds = new Set((canonicalDef!.memoryFeatures ?? []).map((f) => f.id));

        const slotCheats = cheatsForHotkeySlots(game);
        assert.ok(slotCheats.length > 0, `${game.gameId} must have at least one hotkey-addressable cheat`);
        for (const cheat of slotCheats) {
          assert.ok(
            canonicalIds.has(cheat.id),
            `${game.gameId}: hotkey-slot cheat "${cheat.id}" has no matching canonical MemoryFeatureV1.id — ` +
              'a hotkey targeting this slot would resolve against a feature that does not exist in the canonical definition.',
          );
        }
      }
    });
  });

  describe('Hotkey canonical identity (§7/§8) — RESOLVED-BY-CONSTRUCTION, locked', () => {
    test('hotkey slot selection and canonical bundled-definition seeding use the identical pinned-or-first-12 source list', () => {
      // Both cheat-hotkey-slots.ts's cheatsForHotkeySlots() and
      // bundled-definition-seed.ts's pinnedCheatsForGame() select from the
      // same static game.cheats/game.pinnedCheatIds — this is what makes
      // "slot N always resolves to a stable canonical feature id" true today
      // without a separate persisted slot->feature binding. This test proves
      // the underlying invariant directly (not just its output for one game):
      // for every curated game, the hotkey-slot list is exactly the pinned
      // (or first-12) cheat id sequence, in the same order.
      const memoryGames = ALL_GAMES.filter(
        (g) => (g.cheatDiscoveryType === 'memory-scan' || g.cheatDiscoveryType === 'hybrid') && g.gameId !== 'avowed',
      );
      for (const game of memoryGames) {
        const expectedIds = game.pinnedCheatIds?.length
          ? game.pinnedCheatIds.filter((id) => game.cheats.some((c) => c.id === id)).slice(0, 12)
          : game.cheats.slice(0, 12).map((c) => c.id);
        const slotIds = cheatsForHotkeySlots(game).map((c) => c.id);
        assert.deepEqual(slotIds, expectedIds, `${game.gameId}: hotkey slot order must match pinned/first-12 selection exactly`);
      }
    });
  });

  describe('GameProfile / ProfileControl (§11) — retirement candidate, no live consumer', () => {
    test('profileControlToTrainerControl remains a pure, disconnected adapter (no runtime caller wires it to save-edit resolution)', () => {
      // dual-read-save-controls.ts's loadStardewProfileControls() is
      // @deprecated and always returns [] — GameProfile/ProfileControl no
      // longer feeds real save-edit execution. This locks that the adapter
      // function itself still type-checks/executes standalone (so it remains
      // a safe, inert compatibility shape rather than a dangling reference to
      // something already removed), without asserting it is wired anywhere.
      const control = profileControlToTrainerControl({
        id: 'test-control',
        label: 'Test Control',
        description: 'Test control description',
        category: 'stats',
        controlType: 'number_input',
        backend: 'save_field',
        safetyStatus: 'supported',
        saveField: { filePath: 'Save.xml', fieldPath: 'player.gold', gameId: 'test-game' },
      });
      assert.equal(control.id, 'test-control');
    });
  });

  describe('Recipe -> canonical adapter (§9/§15/§16)', () => {
    function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
      return {
        id: gameId('recipe'),
        name: 'Player Gold',
        gameId: 'test-game',
        category: 'Currency',
        source: 'discovery',
        target: 'SaveGameInfo',
        path: 'SaveGame.player.0.money',
        valueType: 'number',
        risk: 'safe',
        requiresBackup: true,
        confidence: 92,
        createdAt: '2026-09-17T00:00:00.000Z',
        updatedAt: '2026-09-17T00:00:00.000Z',
        ...overrides,
      };
    }

    test('maps a valid Recipe to a SaveFieldFeatureV1, classified LOSSY_WITH_WARNING (§16) — every non-representable field reported', () => {
      const recipe = baseRecipe();
      const result = recipeToSaveFieldFeature(recipe);
      assert.equal(result.success, true);
      if (!result.success) return;

      assert.equal(result.feature.id, recipe.id);
      assert.equal(result.feature.name, 'Player Gold');
      assert.equal(result.feature.category, 'Currency');
      assert.equal(result.feature.dataType, 'number');
      assert.equal(result.feature.mapping.searchKey, 'SaveGame.player.0.money');

      // Fields SaveFieldFeatureV1 has no equivalent for must be explicitly
      // reported, never silently dropped (mission §14).
      for (const field of ['source', 'target', 'risk', 'requiresBackup', 'confidence', 'createdAt', 'updatedAt']) {
        assert.ok(result.losses.includes(field), `expected "${field}" to be reported as a loss`);
      }
    });

    test('fails closed (not lossy-success) for a Recipe with no field path', () => {
      const recipe = baseRecipe({ path: '' });
      const result = recipeToSaveFieldFeature(recipe);
      assert.equal(result.success, false);
      if (result.success) return;
      assert.equal(result.reason, 'recipe_has_no_field_path');
    });

    test('unsupported/stale Recipe semantics are reported as warnings, not hidden (§16 test 18)', () => {
      const recipe = baseRecipe({ needsRescan: true, isActive: false });
      const result = recipeToSaveFieldFeature(recipe);
      assert.equal(result.success, true);
      if (!result.success) return;
      assert.ok(result.warnings.some((w) => w.includes('needsRescan')));
      assert.ok(result.warnings.some((w) => w.includes('inactive')));
    });

    test('batch conversion collects per-recipe failures without aborting the whole batch (§16 test 19)', () => {
      const good = baseRecipe();
      const bad = baseRecipe({ path: '' });
      const { features, failures, losses } = recipesToSaveFieldFeatures([good, bad]);
      assert.equal(features.length, 1);
      assert.equal(failures.length, 1);
      assert.equal(failures[0]?.recipeId, bad.id);
      assert.ok(losses[good.id]?.length ?? 0 > 0);
    });
  });

  describe('Trainer Host boundary (§17, mission tests 26/27)', () => {
    test('a memory feature never dispatches to the save-field backend, even sharing an id with a real save field', () => {
      const id = gameId('boundary');
      const definition: SolithDefinitionV1 = {
        schemaVersion: 1,
        id,
        title: 'Boundary Test',
        gameVersion: '*',
        executableHashPrefixes: [],
        author: 'test',
        safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
        target: { executables: ['Demo.exe'], arch: 'x64' },
        memoryFeatures: [
          {
            id: 'shared-id',
            name: 'Memory Gold',
            category: 'Currency',
            type: 'freeze',
            dataType: 'int32',
            defaultValue: 9999,
            resolution: { moduleName: 'Demo.exe', baseOffset: '0x1000' },
          },
        ],
        saveEditor: {
          defaultDirectory: 'C:/Saves',
          extension: 'sav',
          format: 'json',
          saveFields: [
            {
              id: 'save-gold',
              name: 'Save Gold',
              category: 'Currency',
              dataType: 'number',
              mapping: { searchKey: 'player.gold' },
            },
          ],
        },
      };

      const controls = solithDefinitionToTrainerControls(definition);
      // Test 26: the canonical save-field feature does dispatch to the save backend.
      assert.equal(controls.length, 1);
      assert.equal(controls[0]?.id, 'save-gold');
      assert.equal(controls[0]?.backend, 'save_field');
      // Test 27: the memory feature (even a same-shaped id) never appears
      // among TrainerHost-dispatchable controls — memoryFeatures is never
      // read by solithDefinitionToTrainerControls at all.
      assert.ok(!controls.some((c) => c.id === 'shared-id'));
    });
  });

  describe('Hub write convergence (§12, mission tests 22-25)', () => {
    test('a synced hub definition is readable through getCanonicalTrainerDefinition with remote-authoritative provenance', async () => {
      setSetting('communitySyncEnabled', true);
      const id = gameId('hub-converge');
      const updatedAt = '2026-09-17T10:00:00.000Z';

      const result = await syncCommunityDefinitions({
        fetchImpl: async () => new Response(JSON.stringify({
          definitions: [{
            id: 'hub-record-converge-1',
            game_id: id,
            executable_hash: 'a'.repeat(64),
            cert_level: 'L3_Certified',
            definition_payload: {
              schemaVersion: 1,
              id,
              title: 'Hub Converge Test',
              gameVersion: '*',
              executableHashPrefixes: ['aaaa'],
              author: 'Hub Author',
              safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
              target: { executables: ['Demo.exe'], arch: 'x64' },
              memoryFeatures: [{
                id: 'gold', name: 'Gold', category: 'Currency', type: 'freeze' as const,
                dataType: 'int32' as const, defaultValue: 9999,
                resolution: { moduleName: 'Demo.exe', baseOffset: '0x1000' },
              }],
            },
            created_at: updatedAt,
            updated_at: updatedAt,
          }],
          count: 1,
          next_since: '2026-09-17T10:01:00.000Z',
          has_more: false,
        })),
      });
      assert.equal(result.imported, 1);

      // Test 22: hub write routes through canonical persistence — readable
      // via the same repository every other source uses, deterministic packId.
      const canonical = getCanonicalTrainerDefinition(id);
      assert.equal(canonical.success, true);
      if (!canonical.success) return;
      assert.equal(canonical.value.packId, `${id}-pack-solith-hub`);

      // Test 23: provenance preserved (sourceProvider, sourceId = hub record id).
      assert.equal(canonical.value.provenance.sourceProvider, 'solith-hub');
      assert.equal(canonical.value.provenance.sourceType, 'hub_sync');
      assert.equal(canonical.value.provenance.sourceId, 'hub-record-converge-1');

      // Test 24: certification preserved honestly — L3_Certified maps to
      // 'verified', never silently escalated beyond what the hub actually sent.
      assert.equal(canonical.value.provenance.certLevel, 'L3_Certified');
      assert.equal(canonical.value.definition.safety.verificationStatus, 'verified');
      // trustHubCertification always forces these true regardless of remote claims.
      assert.equal(canonical.value.definition.safety.requiresApproval, true);
      assert.equal(canonical.value.definition.safety.requiresOfflineConfirm, true);

      // Test 25: timestamps preserved correctly — the hub's own updated_at,
      // not this process's local write time.
      assert.equal(canonical.value.provenance.syncedAt, updatedAt);
    });
  });
});

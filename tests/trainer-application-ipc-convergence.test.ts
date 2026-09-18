import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import db, { resetForTesting, closeDatabaseSafely, flushPersistence } from '../src/core/database/index.js';
import { persistTrainerDefinition, getCanonicalTrainerDefinition } from '../src/core/trainer-storage/repository.js';
import { trainerApplicationService } from '../src/core/trainer-application/index.js';
import { importDefinitionYaml } from '../src/core/definitions/import-definition.js';
import { promoteDefinitionToVerified } from '../src/core/trainer-catalog/definition-promotion.js';
import { recordDefinitionFeedback } from '../src/core/trainer-catalog/definition-feedback-store.js';
import { exportDiscoveryCandidateToYaml } from '../src/core/definitions/export-definition.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import type { DiscoveryResult } from '../src/shared/types/index.js';

let uid = 0;
function gameId(label: string): string {
  uid += 1;
  return `p49-${label}-${Date.now()}-${uid}`;
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

const SAMPLE_CANDIDATE: DiscoveryResult = {
  path: 'SaveGame.player.0.money',
  oldValue: 500,
  newValue: 9999,
  confidence: 92,
  description: 'Gold changed after purchase',
  suggestedCategory: 'CURRENCY',
  suggestedName: 'Money',
  valueType: 'number',
  risk: 'safe',
};

describe('P4-9: canonical trainer application service + write-path convergence', () => {
  let tempDbDir: string;
  let tempDbPath: string;

  before(async () => {
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-p49-test-'));
    tempDbPath = path.join(tempDbDir, 'test-trainer-application.sqlite');
    await resetForTesting(tempDbPath);
    await flushPersistence();
  });

  after(async () => {
    await closeDatabaseSafely();
    if (fs.existsSync(tempDbDir)) fs.rmSync(tempDbDir, { recursive: true, force: true });
  });

  describe('trainerApplicationService', () => {
    test('getTrainer/saveTrainer/listTrainers/removeTrainer forward to the P4-8 repository unchanged', () => {
      const id = gameId('service');
      const def = definitionFor(id);

      const saved = trainerApplicationService.saveTrainer(def, { sourceProvider: 'user' });
      assert.equal(saved.success, true);

      const loaded = trainerApplicationService.getTrainer(id);
      assert.equal(loaded.success, true);
      if (!loaded.success) return;
      assert.equal(loaded.value.definition.id, id);
      assert.equal(loaded.value.provenance.sourceProvider, 'user');

      const listed = trainerApplicationService.listTrainers();
      assert.equal(listed.success, true);
      if (!listed.success) return;
      assert.ok(listed.value.records.some((r) => r.catalogGameId === id));

      const removed = trainerApplicationService.removeTrainer(id);
      assert.equal(removed.success, true);
      const afterRemove = trainerApplicationService.getTrainer(id);
      assert.equal(afterRemove.success, false);
    });

    test('getTrainer surfaces a typed error reason for a missing trainer', () => {
      const result = trainerApplicationService.getTrainer(gameId('missing'));
      assert.equal(result.success, false);
      if (result.success) return;
      assert.equal(result.error.reason, 'NOT_FOUND');
    });
  });

  describe('write-path packId collision fix (import-definition.ts)', () => {
    test('YAML import for a game that already has a bundled row gets its own source-suffixed packId, not the bundled packId', () => {
      const id = gameId('yaml-collision');

      // exportDiscoveryCandidateToYaml derives the compiled definition's id
      // as `custom_${gameId}` — build the bundled row under that SAME
      // resulting id so the two rows genuinely target the same catalog game.
      const bundle = exportDiscoveryCandidateToYaml({
        gameId: id,
        gameName: `Test Game ${id}`,
        executables: ['Demo.exe'],
        saveFilePath: 'C:/Users/me/AppData/Roaming/Test/Saves/Slot_1/SaveGameInfo',
        candidate: SAMPLE_CANDIDATE,
      });
      const compiledId = bundle.definition.id;

      const bundledSave = persistTrainerDefinition(definitionFor(compiledId), { sourceProvider: 'bundled' });
      assert.equal(bundledSave.success, true);
      if (!bundledSave.success) return;
      assert.equal(bundledSave.value.packId, `${compiledId}-pack`);

      const imported = importDefinitionYaml(bundle.yaml);
      assert.equal(imported.success, true);
      if (!imported.success) return;
      assert.equal(imported.catalogGameId, compiledId);

      // The import must land on its own row (source-suffixed packId), never
      // silently overwriting the pre-existing bundled row at `${compiledId}-pack`.
      assert.notEqual(imported.packId, `${compiledId}-pack`);
      assert.ok(imported.packId.endsWith('-user'));

      // Bundled row must still exist afterward — surfaced as a conflicting
      // source, never silently dropped (mission §21/§30).
      const canonical = getCanonicalTrainerDefinition(imported.catalogGameId);
      assert.equal(canonical.success, true);
      if (!canonical.success) return;
      assert.equal(canonical.value.provenance.sourceProvider, 'user');
      assert.ok(canonical.value.provenance.conflictingSources.some((c) => c.sourceProvider === 'bundled'));
    });
  });

  describe('promotion cross-source packId fix (definition-promotion.ts)', () => {
    test('promoting a community-sourced definition updates the SAME packId, not a new "promotion"-sourced row', () => {
      const id = gameId('promotion');
      const def: SolithDefinitionV1 = {
        ...definitionFor(id),
        safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
        memoryFeatures: [
          {
            id: 'gold',
            name: 'Gold',
            category: 'Currency',
            type: 'toggle',
            dataType: 'int32',
            defaultValue: 9999,
            resolution: { moduleName: 'Demo.exe', baseOffset: '0x1000' },
            certificationLevel: 'L3',
          },
        ],
      };
      const saved = persistTrainerDefinition(def, { sourceProvider: 'ct-import' });
      assert.equal(saved.success, true);
      if (!saved.success) return;
      const originalPackId = saved.value.packId;
      assert.equal(originalPackId, `${id}-pack-ct-import`);

      // Give it enough positive feedback to clear the eligibility gate.
      for (let i = 0; i < 3; i += 1) {
        recordDefinitionFeedback({ catalogGameId: id, featureId: 'gold', rating: 1 });
      }

      const promoted = promoteDefinitionToVerified(saved.value.definition);
      assert.equal(promoted.safety.verificationStatus, 'verified');

      const canonical = getCanonicalTrainerDefinition(id);
      assert.equal(canonical.success, true);
      if (!canonical.success) return;
      // Still the original ct-import packId — promotion updated the existing
      // row in place instead of creating a second, unranked 'promotion' row.
      assert.equal(canonical.value.packId, originalPackId);
      assert.equal(canonical.value.provenance.sourceProvider, 'ct-import');
      assert.equal(canonical.value.provenance.conflictingSources.length, 0);
      assert.equal(canonical.value.definition.safety.verificationStatus, 'verified');
    });
  });

  describe('trainer-catalog-get-trainer-controls / trainer-deck-get "bundled-only" fix', () => {
    test('both IPC handlers inject the canonical loadCatalogDefinition into resolveSaveEditControlsDualRead', async () => {
      // Regression lock for the confirmed defect: resolveSaveEditControlsDualRead's
      // default loadDefinition only ever serves the 3 bundled test definitions
      // (see src/core/definitions/dual-read-save-controls.ts's own doc comment).
      // Both real-catalog-facing IPC handlers must pass `deps.loadDefinition`.
      const catalogIpc = await fsp.readFile(new URL('../electron/trainer-catalog-ipc.ts', import.meta.url), 'utf8');
      const deckIpc = await fsp.readFile(new URL('../electron/trainer-deck-ipc.ts', import.meta.url), 'utf8');
      assert.match(catalogIpc, /resolveSaveEditControlsDualRead\(\s*\{\s*catalogGameId:[^}]*\},\s*\{\s*loadDefinition:\s*loadCatalogDefinition\s*\}\s*\)/);
      assert.match(deckIpc, /resolveSaveEditControlsDualRead\(\s*\{\s*catalogGameId\s*\},\s*\{\s*loadDefinition:\s*loadCatalogDefinition\s*\}\s*\)/);
    });
  });
});

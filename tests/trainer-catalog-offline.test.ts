import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/core/database/index.ts';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.ts';
import {
  recordDefinitionFeedback,
  getDefinitionFeedbackSummary,
  listDefinitionFeedback,
} from '../src/core/trainer-catalog/definition-feedback-store.ts';
import {
  evaluatePromotionEligibility,
  promoteDefinitionToVerified,
} from '../src/core/trainer-catalog/definition-promotion.ts';
import {
  quarantineDefinition,
  isDefinitionQuarantined,
  listPendingDefinitionUpdates,
  resolveDefinitionUpdate,
} from '../src/core/trainer-catalog/definition-quarantine.ts';
import {
  getCatalogEntry,
  getDefinitionPayload,
  upsertCatalogEntry,
  upsertDefinitionPayload,
} from '../src/core/trainer-catalog/store.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

function makeDefinition(id: string, certLevel: 'L0' | 'L3' = 'L3'): SolithDefinitionV1 {
  return {
    schemaVersion: 1,
    id,
    title: `Test ${id}`,
    gameVersion: '1.0.0',
    executableHashPrefixes: ['abc123'],
    author: 'test',
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: { executables: ['Test.exe'], arch: 'x64' },
    memoryFeatures: [
      {
        id: 'health',
        name: 'Health',
        category: 'Player',
        type: 'freeze',
        dataType: 'float',
        defaultValue: 100,
        certificationLevel: certLevel,
        resolution: {
          moduleName: 'Test.exe',
          baseOffset: '0x100',
          pointerChain: [0x18],
        },
      },
    ],
  };
}

function makeCatalogEntry(catalogGameId: string, status: TrainerCatalogEntry['verificationStatus']): TrainerCatalogEntry {
  return {
    catalogGameId,
    displayName: `Game ${catalogGameId}`,
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: status,
    sources: [],
    hasModPack: true,
    modPackId: `${catalogGameId}-pack`,
    cheatCount: 1,
    searchableText: catalogGameId,
  };
}

function seedDefinition(definition: SolithDefinitionV1): void {
  upsertCatalogEntry(makeCatalogEntry(definition.id, definition.safety.verificationStatus));
  upsertDefinitionPayload(
    `${definition.id}-pack`,
    definition.id,
    JSON.stringify(definition),
    definition.safety.verificationStatus,
    'test',
    new Date().toISOString(),
  );
}

describe('trainer-catalog offline — feedback', () => {
  before(async () => {
    await initDatabase();
  });

  test('records and summarizes positive/negative ratings', () => {
    const gameId = `feedback-${Date.now()}`;
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: -1 });

    const summary = getDefinitionFeedbackSummary(gameId, 'health');
    assert.equal(summary.positive, 2);
    assert.equal(summary.negative, 1);
    assert.equal(summary.total, 3);
    assert.equal(listDefinitionFeedback(gameId).length, 3);
  });
});

describe('trainer-catalog offline — quarantine', () => {
  before(async () => {
    await initDatabase();
  });

  test('queues drift and downgrades verified definition to community', () => {
    const gameId = `quarantine-${Date.now()}`;
    const definition = makeDefinition(gameId, 'L3');
    definition.safety.verificationStatus = 'verified';
    seedDefinition(definition);

    quarantineDefinition(gameId, 'executable_hash_drift');

    assert.equal(isDefinitionQuarantined(gameId), true);
    const pending = listPendingDefinitionUpdates();
    assert.ok(pending.some((row) => row.catalogGameId === gameId));

    const downgraded = getDefinitionPayload(gameId);
    assert.equal(downgraded?.safety.verificationStatus, 'community');
    assert.equal(downgraded?.memoryFeatures?.[0]?.certificationLevel, 'L0');
    assert.equal(getCatalogEntry(gameId)?.verificationStatus, 'community');

    const row = pending.find((r) => r.catalogGameId === gameId);
    assert.ok(row);
    resolveDefinitionUpdate(row!.id, 'test-operator');
    assert.equal(isDefinitionQuarantined(gameId), false);
  });
});

describe('trainer-catalog offline — promotion', () => {
  before(async () => {
    await initDatabase();
  });

  test('blocks promotion without enough community feedback', () => {
    const gameId = `promo-block-${Date.now()}`;
    const definition = makeDefinition(gameId, 'L3');
    seedDefinition(definition);

    const eligibility = evaluatePromotionEligibility(definition);
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.some((r) => r.startsWith('community_feedback_')));
    assert.throws(() => promoteDefinitionToVerified(definition), /promotion_blocked/);
  });

  test('promotes community definition when feedback and certification pass', () => {
    const gameId = `promo-pass-${Date.now()}`;
    const definition = makeDefinition(gameId, 'L3');
    seedDefinition(definition);

    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });

    const eligibility = evaluatePromotionEligibility(definition);
    assert.equal(eligibility.eligible, true);

    const promoted = promoteDefinitionToVerified(definition);
    assert.equal(promoted.safety.verificationStatus, 'verified');
    assert.equal(getCatalogEntry(gameId)?.verificationStatus, 'verified');
    assert.equal(getDefinitionPayload(gameId)?.safety.verificationStatus, 'verified');
  });

  test('blocks promotion when certification level is below L3', () => {
    const gameId = `promo-l0-${Date.now()}`;
    const definition = makeDefinition(gameId, 'L0');
    seedDefinition(definition);

    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });
    recordDefinitionFeedback({ catalogGameId: gameId, featureId: 'health', rating: 1 });

    const eligibility = evaluatePromotionEligibility(definition);
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.some((r) => r.includes('below_L3')));
  });
});

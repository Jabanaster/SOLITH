import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TrainerRuntime } from '../src/core/trainer-runtime/runtime.js';
import { trainerApplicationService } from '../src/core/trainer-application/service.js';
import { FakeTrainerRuntimeCapabilities } from './fixtures/fake-trainer-runtime-capabilities.js';
import { ALL_GAMES } from '../src/core/cheat-system/games.js';
import { bundledDefinitionsForTests } from '../src/core/trainer-catalog/bundled-definition-seed.js';
import type { LiveMemoryAddress } from '../src/core/live-memory/types.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';

/**
 * P4-13 — Canonical Execution Convergence.
 *
 * Covers the new canonical-discovery-resolution handoff
 * (TrainerRuntime.seedDiscoveredFeatureAddress + the widened
 * scan_first/scan_unknown write/freeze gates in runtime.ts) and the
 * bundled-definition-seed.ts full-catalog-coverage fix. GameConfig UI
 * cutover itself (useGameCheatSession.ts) is exercised indirectly through
 * this same runtime/service boundary — node:test cannot drive React hooks
 * against a real Electron IPC bridge, matching the P4-10 suite's own
 * documented boundary choice.
 */

const DEFINITION: SolithDefinitionV1 = {
  schemaVersion: 1,
  id: 'demo-discovery-game',
  title: 'Demo Discovery Game',
  gameVersion: '*',
  executableHashPrefixes: [],
  author: 'test',
  safety: { requiresApproval: true, requiresOfflineConfirm: true, verificationStatus: 'community' },
  target: { executables: ['Demo.exe'], arch: 'x64' },
  memoryFeatures: [
    {
      id: 'discovered-gold',
      name: 'Gold (discovery-backed)',
      category: 'Currency',
      type: 'scan_unknown',
      dataType: 'int32',
      defaultValue: 9999,
      resolution: { moduleName: 'Demo.exe' },
    },
    {
      id: 'discovered-ammo',
      name: 'Ammo (discovery-backed, scan_first)',
      category: 'Weapons',
      type: 'scan_first',
      dataType: 'int32',
      defaultValue: 99,
      resolution: { moduleName: 'Demo.exe' },
    },
    {
      id: 'pointer-health',
      name: 'Health (real pointer path)',
      category: 'Survival',
      type: 'toggle',
      dataType: 'int32',
      defaultValue: 100,
      resolution: { moduleName: 'Demo.exe', baseOffset: '0x2000' },
    },
  ],
};

const TARGET_INPUT = { pid: 4242, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe' };

function makeAddress(offset: number): LiveMemoryAddress {
  return { address: BigInt(offset), moduleName: 'Demo.exe', dataType: 'int32' };
}

async function readyRuntime(): Promise<{ runtime: TrainerRuntime; capabilities: FakeTrainerRuntimeCapabilities }> {
  const capabilities = new FakeTrainerRuntimeCapabilities();
  const runtime = new TrainerRuntime(capabilities);
  runtime.load(DEFINITION);
  runtime.validate();
  runtime.checkCompatibility(TARGET_INPUT);
  capabilities.simulateAlreadyAttached(TARGET_INPUT);
  const bind = await runtime.bindExisting({ pid: TARGET_INPUT.pid, executableName: TARGET_INPUT.executableName });
  assert.equal(bind.success, true, 'bindExisting should succeed');
  return { runtime, capabilities };
}

describe('P4-13 canonical discovery-resolution handoff', () => {
  test('a scan_unknown feature cannot be written before discovery — fails closed, no silent fallback', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.proposeWriteFeature('discovered-gold', 5000);
    assert.equal(result.success, false);
    if (result.success === false) {
      assert.equal(result.error.reason, 'TARGET_RESOLUTION_FAILED');
    }
  });

  test('seedDiscoveredFeatureAddress + proposeWriteFeature: a real Phase 2 discovery result becomes canonically writable', async () => {
    const { runtime } = await readyRuntime();
    const seeded = runtime.seedDiscoveredFeatureAddress('discovered-gold', makeAddress(0x9000));
    assert.equal(seeded.success, true);

    const propose = await runtime.proposeWriteFeature('discovered-gold', 5000);
    assert.equal(propose.success, true);
    if (propose.success === true) {
      assert.equal(propose.value.target.address, 0x9000n);
      const confirm = await runtime.confirmWriteFeature('discovered-gold', propose.value.proposalId, { kind: 'approved' } as never);
      assert.equal(confirm.success, true);
    }
  });

  test('seedDiscoveredFeatureAddress + proposeFreezeFeature: a scan_first feature becomes canonically freezable once seeded', async () => {
    const { runtime } = await readyRuntime();
    const seeded = runtime.seedDiscoveredFeatureAddress('discovered-ammo', makeAddress(0xa000));
    assert.equal(seeded.success, true);

    const propose = await runtime.proposeFreezeFeature('discovered-ammo', 99);
    assert.equal(propose.success, true);
  });

  test('a scan_first feature cannot be frozen before discovery — fails closed', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.proposeFreezeFeature('discovered-ammo', 99);
    assert.equal(result.success, false);
    if (result.success === false) {
      assert.equal(result.error.reason, 'TARGET_RESOLUTION_FAILED');
    }
  });

  test('seedDiscoveredFeatureAddress refuses a feature with a real static resolution strategy — never overrides a genuine AOB/pointer path', async () => {
    const { runtime } = await readyRuntime();
    const result = runtime.seedDiscoveredFeatureAddress('pointer-health', makeAddress(0xdead));
    assert.equal(result.success, false);
    if (result.success === false) {
      assert.equal(result.error.reason, 'UNSUPPORTED_ACTION');
    }
  });

  test('seedDiscoveredFeatureAddress refuses an unknown feature id', async () => {
    const { runtime } = await readyRuntime();
    const result = runtime.seedDiscoveredFeatureAddress('does-not-exist', makeAddress(0x1));
    assert.equal(result.success, false);
    if (result.success === false) {
      assert.equal(result.error.reason, 'SEMANTIC_INVALID');
    }
  });

  test('trainerApplicationService.seedDiscoveredFeature is a thin passthrough to the runtime', async () => {
    const { runtime } = await readyRuntime();
    const result = trainerApplicationService.seedDiscoveredFeature(runtime, 'discovered-gold', makeAddress(0x1234));
    assert.equal(result.success, true);
  });
});

describe('P4-13 bundled canonical coverage for GameConfig cheats (mission §7)', () => {
  const definitionsById = new Map(bundledDefinitionsForTests().map((d) => [d.id, d]));

  const memoryScanGames = ALL_GAMES.filter(
    (game) =>
      (game.cheatDiscoveryType === 'memory-scan' || game.cheatDiscoveryType === 'hybrid') &&
      game.gameId !== 'avowed',
  );

  test('every curated memory-scan/hybrid game has a bundled canonical definition', () => {
    for (const game of memoryScanGames) {
      assert.ok(definitionsById.has(game.gameId), `Expected a bundled canonical definition for "${game.gameId}"`);
    }
  });

  test('every memory-backed CheatDefinition (valueType !== "string") has a matching canonical MemoryFeatureV1 — not just a pinned subset', () => {
    for (const game of memoryScanGames) {
      const definition = definitionsById.get(game.gameId);
      assert.ok(definition, `Missing bundled definition for "${game.gameId}"`);
      const featureIds = new Set((definition!.memoryFeatures ?? []).map((f) => f.id));
      const memoryBackedCheats = game.cheats.filter((c) => c.valueType !== 'string');
      for (const cheat of memoryBackedCheats) {
        assert.ok(
          featureIds.has(cheat.id),
          `Game "${game.gameId}" cheat "${cheat.id}" (valueType=${cheat.valueType}) has no canonical MemoryFeatureV1 — full-catalog coverage regressed`,
        );
      }
    }
  });

  test('console-command-only cheats (valueType === "string") are never fabricated as canonical memory features', () => {
    for (const game of memoryScanGames) {
      const definition = definitionsById.get(game.gameId);
      const featureIds = new Set((definition!.memoryFeatures ?? []).map((f) => f.id));
      const stringCheats = game.cheats.filter((c) => c.valueType === 'string');
      for (const cheat of stringCheats) {
        assert.ok(!featureIds.has(cheat.id), `Cheat "${cheat.id}" is console-command-only (valueType: string) and must not have a fabricated memory feature`);
      }
    }
  });

  test('every generated canonical definition still validates and semantically type-checks', async () => {
    const { validateDefinitionSemantics } = await import('../src/core/trainer-runtime/runtime.js');
    for (const game of memoryScanGames) {
      const definition = definitionsById.get(game.gameId)!;
      const issues = validateDefinitionSemantics(definition);
      assert.deepEqual(issues, [], `Definition "${definition.id}" has semantic issues: ${issues.join('; ')}`);
    }
  });
});

// P4-13 mission §17 — source-scan regression proof: the canonical execution
// IPC must have a real renderer consumer, and the legacy hook must no longer
// perform direct mutation (write/freeze) through the raw liveMemory* channel.
describe('P4-13 source-scan: renderer wiring (mission §17)', () => {
  const HOOK_PATH = fileURLToPath(new URL('../src/app/hooks/useGameCheatSession.ts', import.meta.url));
  const hookSource = readFileSync(HOOK_PATH, 'utf-8');

  test('useGameCheatSession.ts references the canonical trainer execution IPC wrappers', () => {
    for (const wrapper of [
      'trainerBindRuntime',
      'trainerUnbindRuntime',
      'trainerSeedDiscoveredFeature',
      'trainerProposeWriteFeature',
      'trainerIssueWriteConsent',
      'trainerConfirmWriteFeature',
      'trainerProposeFreezeFeature',
      'trainerIssueFreezeConsent',
      'trainerConfirmFreezeFeature',
      'trainerDeactivateFeature',
      'trainerRollbackFeature',
    ]) {
      assert.ok(hookSource.includes(wrapper), `Expected useGameCheatSession.ts to call window.electronAPI.${wrapper}`);
    }
  });

  test('useGameCheatSession.ts no longer performs direct mutation through the legacy liveMemory* write/freeze channel', () => {
    for (const legacyMutationCall of [
      'liveMemoryProposeWrite',
      'liveMemoryIssueWriteConsent',
      'liveMemoryConfirmWrite',
      'liveMemoryFreezePropose',
      'liveMemoryFreezeRequestConsent',
      'liveMemoryFreezeStart',
      'liveMemoryFreezeStop',
    ]) {
      // Matches an actual call (`electronAPI.name(`), not a doc-comment mention of the retired name.
      assert.ok(
        !hookSource.includes(`${legacyMutationCall}(`),
        `useGameCheatSession.ts still calls legacy mutation channel "${legacyMutationCall}" — canonical cutover regressed`,
      );
    }
  });

  test('useGameCheatSession.ts still uses the legacy channel only for attach/discovery (Phase 2, untouched by this stage)', () => {
    for (const legacyDiscoveryCall of [
      'liveMemoryListProcesses',
      'liveMemoryAttach',
      'liveMemoryZeroInputPrepare',
      'liveMemoryScanFirstAutoMatrix',
      'liveMemoryScanNext',
      'liveMemoryDetach',
    ]) {
      assert.ok(hookSource.includes(legacyDiscoveryCall), `Expected discovery/attach call "${legacyDiscoveryCall}" to remain (Phase 2 is out of scope for P4-13)`);
    }
  });
});

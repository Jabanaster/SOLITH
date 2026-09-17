import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TrainerRuntime, validateDefinitionSemantics } from '../src/core/trainer-runtime/runtime.js';
import { canTransition } from '../src/core/trainer-runtime/state.js';
import type { SolithDefinitionV1 } from '../src/core/definitions/schema.v1.js';
import { FakeTrainerRuntimeCapabilities } from './fixtures/fake-trainer-runtime-capabilities.js';
import type { LiveMemoryAddress } from '../src/core/live-memory/types.js';

const DEFINITION: SolithDefinitionV1 = {
  schemaVersion: 1,
  id: 'demo-game',
  title: 'Demo Game',
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
    {
      id: 'health',
      name: 'Infinite Health',
      category: 'Survival',
      type: 'freeze',
      dataType: 'int32',
      defaultValue: 100,
      resolution: { moduleName: 'Demo.exe', baseOffset: '0x2000' },
    },
    {
      id: 'ammo',
      name: 'Ammo',
      category: 'Combat',
      type: 'write_once',
      dataType: 'int32',
      defaultValue: 999,
      resolution: { moduleName: 'Demo.exe', baseOffset: '0x3000' },
    },
    {
      id: 'unknown-stat',
      name: 'Unknown Stat',
      category: 'Misc',
      type: 'scan_unknown',
      dataType: 'int32',
      defaultValue: 0,
      resolution: { moduleName: 'Demo.exe' },
    },
  ],
};

const TARGET_INPUT = { pid: 4242, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe' };
const APPROVED = { kind: 'approved' as const };
const FREEZE_APPROVAL = { consentToken: 'test-token', consentBinding: {} as never };

function makeAddress(offset: number): LiveMemoryAddress {
  return { address: BigInt(offset), moduleName: 'Demo.exe', dataType: 'int32' };
}

/** Runtime already driven through load -> validate -> checkCompatibility -> bind -> READY. */
async function readyRuntime(): Promise<{ runtime: TrainerRuntime; capabilities: FakeTrainerRuntimeCapabilities }> {
  const capabilities = new FakeTrainerRuntimeCapabilities();
  const runtime = new TrainerRuntime(capabilities);
  runtime.load(DEFINITION);
  runtime.validate();
  runtime.checkCompatibility(TARGET_INPUT);
  const bind = await runtime.bind(TARGET_INPUT, true);
  assert.equal(bind.success, true);
  capabilities.resolvedAddresses.set('gold', makeAddress(0x1000));
  capabilities.resolvedAddresses.set('health', makeAddress(0x2000));
  capabilities.resolvedAddresses.set('ammo', makeAddress(0x3000));
  return { runtime, capabilities };
}

describe('trainer-runtime: loading', () => {
  test('1. valid V1 loads', () => {
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    const result = runtime.load(DEFINITION);
    assert.equal(result.success, true);
    assert.equal(runtime.getState(), 'LOADED');
  });

  test('2. legacy/unversioned input migrates then loads', () => {
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    const legacyModPack = {
      packId: 'demo-pack',
      catalogGameId: 'demo-game',
      gameName: 'Demo Game',
      source: { provider: 'user' },
      verificationStatus: 'community',
      versions: [{ versionLabel: '*', executables: ['Demo.exe'] }],
      cheats: [],
      connectionBaseline: 0,
      platform: 'unknown',
      syncedAt: new Date(0).toISOString(),
    };
    const result = runtime.load(legacyModPack);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.value.schemaVersion, 1);
    assert.equal(runtime.getState(), 'LOADED');
  });

  test('3. future schema version rejected', () => {
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    const result = runtime.load({ ...DEFINITION, schemaVersion: 999 });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'INVALID_SCHEMA');
    assert.equal(runtime.getState(), 'FAILED');
  });
});

describe('trainer-runtime: state machine', () => {
  test('4. legal transitions work end to end', async () => {
    const { runtime } = await readyRuntime();
    assert.equal(runtime.getState(), 'READY');
  });

  test('5. illegal transition rejected', () => {
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    // checkCompatibility requires VALIDATED; calling it from UNLOADED must fail closed.
    const result = runtime.checkCompatibility(TARGET_INPUT);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'INVALID_STATE_TRANSITION');
    assert.equal(canTransition('DISPOSED', 'READY'), false);
  });

  test('6. disposed runtime rejects actions', async () => {
    const { runtime } = await readyRuntime();
    runtime.dispose();
    assert.equal(runtime.getState(), 'DISPOSED');
    const result = await runtime.activateWriteFeature('gold', 1, APPROVED);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'INVALID_STATE_TRANSITION');
  });
});

describe('trainer-runtime: semantic validation', () => {
  test('feature with neither signature nor baseOffset is semantically invalid', () => {
    const bad: SolithDefinitionV1 = {
      ...DEFINITION,
      memoryFeatures: [{ ...DEFINITION.memoryFeatures![0], resolution: { moduleName: 'Demo.exe' } }],
    };
    const issues = validateDefinitionSemantics(bad);
    assert.ok(issues.some((i) => i.includes('neither an AOB signature nor a baseOffset')));
  });

  test('duplicate feature ids are semantically invalid', () => {
    const bad: SolithDefinitionV1 = {
      ...DEFINITION,
      memoryFeatures: [DEFINITION.memoryFeatures![0], { ...DEFINITION.memoryFeatures![0] }],
    };
    const issues = validateDefinitionSemantics(bad);
    assert.ok(issues.some((i) => i.includes('Duplicate memoryFeatures id')));
  });
});

describe('trainer-runtime: compatibility', () => {
  test('7. compatible executable accepted', () => {
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    runtime.load(DEFINITION);
    runtime.validate();
    const result = runtime.checkCompatibility(TARGET_INPUT);
    assert.equal(result.success, true);
    assert.equal(runtime.getState(), 'COMPATIBILITY_CHECKED');
  });

  test('8. launcher/system-process role rejected', () => {
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    runtime.load(DEFINITION);
    runtime.validate();
    const result = runtime.checkCompatibility({ pid: 4242, executableName: 'explorer.exe' });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'EXECUTABLE_ROLE_REJECTED');
    assert.equal(runtime.getState(), 'FAILED');
  });

  test('9. incompatible fingerprint rejected', () => {
    const definition: SolithDefinitionV1 = { ...DEFINITION, executableHashPrefixes: ['deadbeef'] };
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    runtime.load(definition);
    runtime.validate();
    const result = runtime.checkCompatibility({ ...TARGET_INPUT, executableHashSHA256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'INCOMPATIBLE_EXECUTABLE');
  });

  test('10. ambiguous/unverifiable identity fails closed, not silently accepted', () => {
    const definition: SolithDefinitionV1 = { ...DEFINITION, executableHashPrefixes: ['deadbeef'] };
    const runtime = new TrainerRuntime(new FakeTrainerRuntimeCapabilities());
    runtime.load(definition);
    runtime.validate();
    // No executableHashSHA256 supplied at all -> cannot verify a declared constraint.
    const result = runtime.checkCompatibility(TARGET_INPUT);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'INCOMPATIBLE_GAME');
  });
});

describe('trainer-runtime: capability availability', () => {
  test('11. required capability available -> action can proceed', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.activateWriteFeature('gold', 1, APPROVED);
    assert.equal(result.success, true);
    assert.equal(runtime.getState(), 'ACTIVE');
  });

  test('12. capability unavailable -> typed failure', async () => {
    const { runtime, capabilities } = await readyRuntime();
    capabilities.nextProposeWriteError = 'write_policy_denied:NO_APPROVAL';
    const result = await runtime.activateWriteFeature('gold', 1, APPROVED);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'CONSENT_REQUIRED');
  });

  test('13. no mutation occurs when capability unavailable', async () => {
    const { runtime, capabilities } = await readyRuntime();
    capabilities.nextProposeWriteError = 'write_policy_denied:NO_APPROVAL';
    await runtime.activateWriteFeature('gold', 1, APPROVED);
    const feature = runtime.getFeatureState('gold');
    assert.equal(feature?.activation.state, 'failed');
    assert.notEqual(runtime.getState(), 'ACTIVE');
  });
});

describe('trainer-runtime: resolution', () => {
  test('14. feature target resolves and delegates to the real capability boundary', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.resolveFeature('gold');
    assert.equal(result.success, true);
    assert.equal(runtime.getFeatureState('gold')?.resolution.state, 'resolved');
  });

  test('15/16. resolution failure is surfaced as a typed error, not thrown raw', async () => {
    const { runtime, capabilities } = await readyRuntime();
    capabilities.resolveErrors.set('ammo', 'AOB signature not found for feature "ammo" and no pointer fallback is configured.');
    const result = await runtime.resolveFeature('ammo');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'TARGET_RESOLUTION_FAILED');
    assert.equal(runtime.getFeatureState('ammo')?.resolution.state, 'failed');
  });

  test('17. scan_first/scan_unknown features are never resolved directly', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.resolveFeature('unknown-stat');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'TARGET_RESOLUTION_FAILED');
    assert.match(result.error.message, /requires discovery scanning/);
  });
});

describe('trainer-runtime: writes', () => {
  test('18. write proposal/confirmation orchestrated end to end', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.activateWriteFeature('ammo', 500, APPROVED);
    assert.equal(result.success, true);
    assert.equal(runtime.getFeatureState('ammo')?.activation.state, 'active');
  });

  test('19. write failure surfaced as typed error', async () => {
    const { runtime, capabilities } = await readyRuntime();
    capabilities.nextConfirmWriteResult = { success: false, error: 'Write failed: driver rejected the address' };
    const result = await runtime.activateWriteFeature('ammo', 500, APPROVED);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'WRITE_FAILED');
  });

  test('20. successful write exposes a rollback reference (proposalId)', async () => {
    const { runtime } = await readyRuntime();
    await runtime.activateWriteFeature('ammo', 500, APPROVED);
    const feature = runtime.getFeatureState('ammo');
    assert.ok(feature?.activation.proposalId, 'expected a proposalId recorded for rollback');
  });
});

describe('trainer-runtime: freeze', () => {
  test('21. freeze starts through the existing capability boundary', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.activateFreezeFeature('health', 100, FREEZE_APPROVAL);
    assert.equal(result.success, true);
    assert.equal(runtime.getFeatureState('health')?.activation.freezeActive, true);
    assert.equal(runtime.getState(), 'ACTIVE');
  });

  test('22. freeze stop works and returns to READY', async () => {
    const { runtime } = await readyRuntime();
    await runtime.activateFreezeFeature('health', 100, FREEZE_APPROVAL);
    const result = runtime.deactivateFreezeFeature('health');
    assert.equal(result.success, true);
    assert.equal(runtime.getFeatureState('health')?.activation.state, 'inactive');
    assert.equal(runtime.getState(), 'READY');
  });

  test('23. freeze capability unavailable fails closed', async () => {
    const { runtime, capabilities } = await readyRuntime();
    capabilities.nextFreezeStartResult = { success: false, error: 'freeze_concurrency_limit:process_limit_exceeded' };
    const result = await runtime.activateFreezeFeature('health', 100, FREEZE_APPROVAL);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'CAPABILITY_UNAVAILABLE');
    assert.notEqual(runtime.getState(), 'ACTIVE');
  });
});

describe('trainer-runtime: rollback', () => {
  test('24. rollback succeeds', async () => {
    const { runtime } = await readyRuntime();
    await runtime.activateWriteFeature('ammo', 500, APPROVED);
    const proposalId = runtime.getFeatureState('ammo')!.activation.proposalId!;
    const result = await runtime.rollbackFeature('ammo', proposalId);
    assert.equal(result.success, true);
    assert.equal(runtime.getFeatureState('ammo')?.activation.state, 'inactive');
  });

  test('25. stale/missing rollback surfaced, not silently ignored', async () => {
    const { runtime } = await readyRuntime();
    const result = await runtime.rollbackFeature('ammo', 'never-proposed-id');
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'INVALID_STATE_TRANSITION');
  });

  test('26. rollback failure explicit', async () => {
    const { runtime, capabilities } = await readyRuntime();
    await runtime.activateWriteFeature('ammo', 500, APPROVED);
    const proposalId = runtime.getFeatureState('ammo')!.activation.proposalId!;
    capabilities.nextRollbackResult = { success: false, error: 'expected_value_mismatch: current value diverged' };
    const result = await runtime.rollbackFeature('ammo', proposalId);
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.error.reason, 'ROLLBACK_FAILED');
  });
});

describe('trainer-runtime: process lifecycle', () => {
  test('27. process loss invalidates READY/ACTIVE state', async () => {
    const { runtime } = await readyRuntime();
    await runtime.activateWriteFeature('ammo', 500, APPROVED);
    const result = runtime.handleProcessLoss('process exited');
    assert.equal(result.success, true);
    assert.equal(runtime.getState(), 'DEGRADED');
    assert.equal(runtime.getFeatureState('ammo')?.activation.state, 'inactive');
    assert.equal(runtime.getFeatureState('gold')?.resolution.state, 'unresolved');
  });

  test('28. stale action prevented after process loss', async () => {
    const { runtime, capabilities } = await readyRuntime();
    capabilities.identityError = 'Unable to re-read live process identity (process may have exited).';
    const verify = runtime.verifyProcessStillBound();
    assert.equal(verify.success, false);
    assert.equal(runtime.getState(), 'DEGRADED');
    const dispatch = await runtime.activateWriteFeature('ammo', 500, APPROVED);
    assert.equal(dispatch.success, false);
    if (dispatch.success) return;
    assert.equal(dispatch.error.reason, 'INVALID_STATE_TRANSITION');
  });

  test('29. rebind requires a fresh compatibility re-check', async () => {
    const { runtime } = await readyRuntime();
    runtime.handleProcessLoss('process exited');
    const recheck = runtime.recheckCompatibilityAfterLoss(TARGET_INPUT);
    assert.equal(recheck.success, true);
    assert.equal(runtime.getState(), 'COMPATIBILITY_CHECKED');
  });
});

describe('trainer-runtime: injection isolation', () => {
  test('30. canonical action dispatch has no path into the in-process-script/hook subsystem', async () => {
    const actionExecutorSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/core/trainer-runtime/action-executor.ts', import.meta.url), 'utf8'),
    );
    const runtimeSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/core/trainer-runtime/runtime.ts', import.meta.url), 'utf8'),
    );
    assert.ok(!actionExecutorSource.includes('in-process-script'));
    assert.ok(!runtimeSource.includes('in-process-script'));
  });
});

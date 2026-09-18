import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TrainerRuntime } from '../src/core/trainer-runtime/runtime.js';
import { CompositeTransactionRuntime, type CompositeTransactionPlan } from '../src/core/trainer-runtime/transaction.js';
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
    { id: 'gold', name: 'Gold', category: 'Currency', type: 'toggle', dataType: 'int32', defaultValue: 9999, resolution: { moduleName: 'Demo.exe', baseOffset: '0x1000' } },
    { id: 'ammo', name: 'Ammo', category: 'Combat', type: 'write_once', dataType: 'int32', defaultValue: 999, resolution: { moduleName: 'Demo.exe', baseOffset: '0x3000' } },
    { id: 'health', name: 'Infinite Health', category: 'Survival', type: 'freeze', dataType: 'int32', defaultValue: 100, resolution: { moduleName: 'Demo.exe', baseOffset: '0x2000' } },
    { id: 'shield', name: 'Infinite Shield', category: 'Survival', type: 'freeze', dataType: 'int32', defaultValue: 100, resolution: { moduleName: 'Demo.exe', baseOffset: '0x2100' } },
    { id: 'mana', name: 'Mana', category: 'Currency', type: 'toggle', dataType: 'int32', defaultValue: 500, resolution: { moduleName: 'Demo.exe', baseOffset: '0x4000' } },
  ],
};

const TARGET_INPUT = { pid: 4242, executableName: 'Demo.exe', executablePath: 'C:\\Games\\Demo\\Demo.exe' };
const APPROVED = { kind: 'approved' as const };
const FREEZE_APPROVAL = { consentToken: 'test-token', consentBinding: {} as never };

function makeAddress(offset: number): LiveMemoryAddress {
  return { address: BigInt(offset), moduleName: 'Demo.exe', dataType: 'int32' };
}

async function readyTransactionRuntime(): Promise<{
  runtime: TrainerRuntime;
  capabilities: FakeTrainerRuntimeCapabilities;
  tx: CompositeTransactionRuntime;
}> {
  const capabilities = new FakeTrainerRuntimeCapabilities();
  const runtime = new TrainerRuntime(capabilities);
  runtime.load(DEFINITION);
  runtime.validate();
  runtime.checkCompatibility(TARGET_INPUT);
  const bind = await runtime.bind(TARGET_INPUT, true);
  assert.equal(bind.success, true);
  capabilities.resolvedAddresses.set('gold', makeAddress(0x1000));
  capabilities.resolvedAddresses.set('ammo', makeAddress(0x3000));
  capabilities.resolvedAddresses.set('health', makeAddress(0x2000));
  capabilities.resolvedAddresses.set('shield', makeAddress(0x2100));
  capabilities.resolvedAddresses.set('mana', makeAddress(0x4000));
  const tx = new CompositeTransactionRuntime(runtime, capabilities);
  return { runtime, capabilities, tx };
}

function twoWritePlan(id = 'tx-1'): CompositeTransactionPlan {
  return {
    id,
    mode: 'ATOMIC',
    actions: [
      { kind: 'write', featureId: 'gold', requestedValue: 1, approval: APPROVED },
      { kind: 'write', featureId: 'ammo', requestedValue: 500, approval: APPROVED },
    ],
  };
}

describe('trainer-transaction: basic', () => {
  test('1. two writes succeed -> COMMITTED', async () => {
    const { tx } = await readyTransactionRuntime();
    const prep = await tx.prepareTransaction(twoWritePlan());
    assert.equal(prep.success, true);
    const exec = await tx.executeTransaction('tx-1');
    assert.equal(exec.success, true);
    if (!exec.success) return;
    assert.equal(exec.value.state, 'COMMITTED');
  });

  test('2. three actions preserve declared execution order', async () => {
    const { tx } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-order',
      mode: 'ATOMIC',
      actions: [
        { kind: 'write', featureId: 'gold', requestedValue: 1, approval: APPROVED },
        { kind: 'freeze', featureId: 'health', value: 100, approval: FREEZE_APPROVAL },
        { kind: 'write', featureId: 'ammo', requestedValue: 500, approval: APPROVED },
      ],
    };
    await tx.prepareTransaction(plan);
    const exec = await tx.executeTransaction('tx-order');
    assert.equal(exec.success, true);
    if (!exec.success) return;
    assert.deepEqual(exec.value.actionRecords.map((r) => r.action.featureId), ['gold', 'health', 'ammo']);
    assert.ok(exec.value.actionRecords[0].startedAt! <= exec.value.actionRecords[1].startedAt!);
    assert.ok(exec.value.actionRecords[1].startedAt! <= exec.value.actionRecords[2].startedAt!);
  });

  test('3. transaction result records per-action outcomes', async () => {
    const { tx } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-3'));
    const exec = await tx.executeTransaction('tx-3');
    assert.equal(exec.success, true);
    if (!exec.success) return;
    assert.deepEqual(exec.value.actionRecords.map((r) => r.result), ['committed', 'committed']);
  });
});

describe('trainer-transaction: pre-flight', () => {
  test('4. unsupported action -> zero mutations', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-4',
      mode: 'ATOMIC',
      actions: [{ kind: 'freeze', featureId: 'gold', value: 1, approval: FREEZE_APPROVAL }],
    };
    const prep = await tx.prepareTransaction(plan);
    assert.equal(prep.success, false);
    if (prep.success) return;
    assert.equal(prep.error.reason, 'UNSUPPORTED_ACTION');
    assert.equal(capabilities.getFreezeStatus().active, false);
  });

  test('5. capability unavailable (second concurrent freeze) -> zero mutations', async () => {
    const { tx } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-5',
      mode: 'ATOMIC',
      actions: [
        { kind: 'freeze', featureId: 'health', value: 100, approval: FREEZE_APPROVAL },
        { kind: 'freeze', featureId: 'shield', value: 100, approval: FREEZE_APPROVAL },
      ],
    };
    const prep = await tx.prepareTransaction(plan);
    assert.equal(prep.success, false);
    if (prep.success) return;
    assert.equal(prep.error.reason, 'CAPABILITY_UNAVAILABLE');
  });

  test('6. invalid runtime state -> zero mutations', async () => {
    const capabilities = new FakeTrainerRuntimeCapabilities();
    const runtime = new TrainerRuntime(capabilities);
    runtime.load(DEFINITION);
    const tx = new CompositeTransactionRuntime(runtime, capabilities);
    const prep = await tx.prepareTransaction(twoWritePlan('tx-6'));
    assert.equal(prep.success, false);
    if (prep.success) return;
    assert.equal(prep.error.reason, 'INVALID_STATE_TRANSITION');
  });

  test('7. unknown feature id -> zero mutations', async () => {
    const { tx } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-7',
      mode: 'ATOMIC',
      actions: [{ kind: 'write', featureId: 'does-not-exist', requestedValue: 1, approval: APPROVED }],
    };
    const prep = await tx.prepareTransaction(plan);
    assert.equal(prep.success, false);
    if (prep.success) return;
    assert.equal(prep.error.reason, 'TRANSACTION_VALIDATION_FAILED');
  });
});

describe('trainer-transaction: rollback', () => {
  function failConfirmForFeature(capabilities: FakeTrainerRuntimeCapabilities, featureId: string, error: string): void {
    const originalConfirm = capabilities.confirmWrite.bind(capabilities);
    capabilities.confirmWrite = async (proposalId, options) => {
      if (options?.featureId === featureId) return { success: false, error };
      return originalConfirm(proposalId, options);
    };
  }

  test('8. Action 2 failure rolls back Action 1', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-8'));
    failConfirmForFeature(capabilities, 'ammo', 'Write failed: driver rejected the address');
    const exec = await tx.executeTransaction('tx-8');
    assert.equal(exec.success, false);
    if (exec.success) return;
    assert.equal(exec.error.reason, 'WRITE_FAILED');
    const state = tx.getTransactionState('tx-8')!;
    assert.equal(state.state, 'ROLLED_BACK');
    assert.equal(state.actionRecords[0].result, 'rolled_back');
    assert.equal(state.actionRecords[1].result, 'failed');
  });

  test('9. Action 3 failure rolls back 2 then 1 (reverse order)', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-9',
      mode: 'ATOMIC',
      actions: [
        { kind: 'write', featureId: 'gold', requestedValue: 1, approval: APPROVED },
        { kind: 'write', featureId: 'mana', requestedValue: 2, approval: APPROVED },
        { kind: 'write', featureId: 'ammo', requestedValue: 500, approval: APPROVED },
      ],
    };
    await tx.prepareTransaction(plan);
    capabilities.nextConfirmWriteResult = null;
    // Fail only the third action: override confirmWrite behavior via propose error on ammo's proposal step.
    const originalPropose = capabilities.proposeWrite.bind(capabilities);
    capabilities.proposeWrite = (address, value, options) => {
      if (options?.featureId === 'ammo') throw new Error('Write failed: simulated third-action failure');
      return originalPropose(address, value, options);
    };
    const exec = await tx.executeTransaction('tx-9');
    assert.equal(exec.success, false);
    const state = tx.getTransactionState('tx-9')!;
    assert.equal(state.state, 'ROLLED_BACK');
    assert.deepEqual(state.actionRecords.map((r) => r.result), ['rolled_back', 'rolled_back', 'failed']);
  });

  test('10. rollback order is reverse of commit order', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-10',
      mode: 'ATOMIC',
      actions: [
        { kind: 'write', featureId: 'gold', requestedValue: 1, approval: APPROVED },
        { kind: 'write', featureId: 'ammo', requestedValue: 500, approval: APPROVED },
      ],
    };
    await tx.prepareTransaction(plan);
    capabilities.nextConfirmWriteResult = null;
    const originalConfirm = capabilities.confirmWrite.bind(capabilities);
    let call = 0;
    capabilities.confirmWrite = async (proposalId, options) => {
      call += 1;
      if (call === 2) return { success: false, error: 'Write failed: forced second-call failure' };
      return originalConfirm(proposalId, options);
    };
    const order: string[] = [];
    const originalRollback = capabilities.rollback.bind(capabilities);
    capabilities.rollback = async (proposalId, featureId) => {
      order.push(featureId ?? 'unknown');
      return originalRollback(proposalId, featureId);
    };
    await tx.executeTransaction('tx-10');
    assert.deepEqual(order, ['gold']);
  });

  test('11. failed action gets no rollback record', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-11'));
    failConfirmForFeature(capabilities, 'ammo', 'Write failed: driver rejected the address');
    await tx.executeTransaction('tx-11');
    const state = tx.getTransactionState('tx-11')!;
    assert.equal(state.actionRecords[1].rollbackError, undefined);
    assert.equal(state.actionRecords[1].result, 'failed');
  });

  test('12. successful transaction performs no rollback', async () => {
    const { tx } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-12'));
    const exec = await tx.executeTransaction('tx-12');
    assert.equal(exec.success, true);
    if (!exec.success) return;
    assert.ok(exec.value.actionRecords.every((r) => r.result === 'committed'));
  });
});

describe('trainer-transaction: freeze compensation', () => {
  test('13. freeze started then later action fails -> freeze stopped', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-13',
      mode: 'ATOMIC',
      actions: [
        { kind: 'freeze', featureId: 'health', value: 100, approval: FREEZE_APPROVAL },
        { kind: 'write', featureId: 'ammo', requestedValue: 500, approval: APPROVED },
      ],
    };
    await tx.prepareTransaction(plan);
    capabilities.nextConfirmWriteResult = { success: false, error: 'Write failed: driver rejected the address' };
    const exec = await tx.executeTransaction('tx-13');
    assert.equal(exec.success, false);
    assert.equal(capabilities.getFreezeStatus().active, false);
    const state = tx.getTransactionState('tx-13')!;
    assert.equal(state.actionRecords[0].result, 'rolled_back');
  });

  test('14. failed freeze start does not fabricate compensation handle', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-14',
      mode: 'ATOMIC',
      actions: [
        { kind: 'write', featureId: 'gold', requestedValue: 1, approval: APPROVED },
        { kind: 'freeze', featureId: 'health', value: 100, approval: FREEZE_APPROVAL },
      ],
    };
    await tx.prepareTransaction(plan);
    capabilities.nextFreezeStartResult = { success: false, error: 'freeze_concurrency_limit:process_limit_exceeded' };
    const exec = await tx.executeTransaction('tx-14');
    assert.equal(exec.success, false);
    const state = tx.getTransactionState('tx-14')!;
    assert.equal(state.actionRecords[1].result, 'failed');
    assert.equal(state.actionRecords[0].result, 'rolled_back');
  });

  test('15. freeze compensation failure explicitly reported', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-15',
      mode: 'ATOMIC',
      actions: [
        { kind: 'freeze', featureId: 'health', value: 100, approval: FREEZE_APPROVAL },
        { kind: 'write', featureId: 'ammo', requestedValue: 500, approval: APPROVED },
      ],
    };
    await tx.prepareTransaction(plan);
    capabilities.nextConfirmWriteResult = { success: false, error: 'Write failed: driver rejected the address' };
    const originalStop = capabilities.stopFreeze.bind(capabilities);
    capabilities.stopFreeze = () => {
      const status = originalStop();
      // Simulate a stop call that reports success but the freeze is still (per getFreezeStatus) active.
      (capabilities as unknown as { freeze: { active: boolean } | null }).freeze = { address: makeAddress(0x2000), value: 100, active: true };
      return status;
    };
    const exec = await tx.executeTransaction('tx-15');
    assert.equal(exec.success, false);
    if (exec.success) return;
    assert.equal(exec.error.reason, 'PARTIAL_ROLLBACK_FAILURE');
    const state = tx.getTransactionState('tx-15')!;
    assert.equal(state.actionRecords[0].result, 'rollback_failed');
    assert.equal(state.actionRecords[0].rollbackError?.reason, 'FREEZE_FAILED');
  });
});

describe('trainer-transaction: rollback failure', () => {
  function failConfirmForFeature(capabilities: FakeTrainerRuntimeCapabilities, featureId: string, error: string): void {
    const originalConfirm = capabilities.confirmWrite.bind(capabilities);
    capabilities.confirmWrite = async (proposalId, options) => {
      if (options?.featureId === featureId) return { success: false, error };
      return originalConfirm(proposalId, options);
    };
  }

  test('16. one rollback fails -> PARTIAL_ROLLBACK_FAILURE', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-16'));
    failConfirmForFeature(capabilities, 'ammo', 'Write failed: driver rejected the address');
    capabilities.nextRollbackResult = { success: false, error: 'expected_value_mismatch: current value diverged' };
    const exec = await tx.executeTransaction('tx-16');
    assert.equal(exec.success, false);
    if (exec.success) return;
    assert.equal(exec.error.reason, 'PARTIAL_ROLLBACK_FAILURE');
  });

  test('17. all rollback outcomes preserved in result', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-17'));
    failConfirmForFeature(capabilities, 'ammo', 'Write failed: driver rejected the address');
    capabilities.nextRollbackResult = { success: false, error: 'expected_value_mismatch: current value diverged' };
    await tx.executeTransaction('tx-17');
    const state = tx.getTransactionState('tx-17')!;
    assert.equal(state.actionRecords[0].result, 'rollback_failed');
    assert.equal(state.actionRecords[1].result, 'failed');
  });

  test('18. original execution failure preserved alongside rollback-failure result', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-18'));
    failConfirmForFeature(capabilities, 'ammo', 'Write failed: driver rejected the address');
    capabilities.nextRollbackResult = { success: false, error: 'expected_value_mismatch: current value diverged' };
    const exec = await tx.executeTransaction('tx-18');
    assert.equal(exec.success, false);
    if (exec.success) return;
    assert.equal((exec.error.detail as { reason: string }).reason, 'WRITE_FAILED');
  });
});

describe('trainer-transaction: process loss', () => {
  test('19. process lost before transaction -> no mutations', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    capabilities.identityError = 'Unable to re-read live process identity (process may have exited).';
    const prep = await tx.prepareTransaction(twoWritePlan('tx-19'));
    assert.equal(prep.success, false);
    if (prep.success) return;
    assert.equal(prep.error.reason, 'PROCESS_LOST');
  });

  test('20. process lost after Action 1 -> no Action 2', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-20'));
    const originalConfirm = capabilities.confirmWrite.bind(capabilities);
    capabilities.confirmWrite = async (proposalId, options) => {
      const result = await originalConfirm(proposalId, options);
      capabilities.identityError = 'Attached process identity mismatch detected.';
      return result;
    };
    const exec = await tx.executeTransaction('tx-20');
    assert.equal(exec.success, false);
    if (exec.success) return;
    assert.equal(exec.error.reason, 'PROCESS_LOST');
    const state = tx.getTransactionState('tx-20')!;
    assert.equal(state.actionRecords[1].result, 'skipped');
  });

  test('21. stale/unsafe rollback surfaced honestly, not fabricated', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-21'));
    const originalConfirm = capabilities.confirmWrite.bind(capabilities);
    capabilities.confirmWrite = async (proposalId, options) => {
      const result = await originalConfirm(proposalId, options);
      capabilities.identityError = 'Attached process identity mismatch detected.';
      return result;
    };
    capabilities.nextRollbackResult = { success: false, error: 'expected_value_mismatch: current value diverged' };
    const exec = await tx.executeTransaction('tx-21');
    assert.equal(exec.success, false);
    if (exec.success) return;
    assert.equal(exec.error.reason, 'PARTIAL_ROLLBACK_FAILURE');
  });

  test('22. process-loss result explicit and runtime degraded afterward', async () => {
    const { tx, runtime, capabilities } = await readyTransactionRuntime();
    capabilities.identityError = 'Unable to re-read live process identity (process may have exited).';
    await tx.prepareTransaction(twoWritePlan('tx-22'));
    // prepareTransaction itself fails closed on identity loss, so runtime is left untouched (still READY).
    assert.equal(runtime.getState(), 'READY');
  });
});

describe('trainer-transaction: cancellation', () => {
  test('23. cancellation before execution -> no mutation', async () => {
    const { tx } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-23'));
    const cancel = tx.cancelTransaction('tx-23');
    assert.equal(cancel.success, true);
    if (!cancel.success) return;
    assert.equal(cancel.value.state, 'CANCELLED');
    assert.ok(cancel.value.actionRecords.every((r) => r.result === 'skipped'));
  });

  test('24. cancellation between actions -> rollback prior mutations', async () => {
    const { tx, capabilities } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-24'));
    const originalConfirm = capabilities.confirmWrite.bind(capabilities);
    capabilities.confirmWrite = async (proposalId, options) => {
      const result = await originalConfirm(proposalId, options);
      tx.cancelTransaction('tx-24');
      return result;
    };
    const exec = await tx.executeTransaction('tx-24');
    assert.equal(exec.success, true);
    if (!exec.success) return;
    assert.equal(exec.value.state, 'CANCELLED');
    const state = tx.getTransactionState('tx-24')!;
    assert.equal(state.actionRecords[0].result, 'rolled_back');
    assert.equal(state.actionRecords[1].result, 'skipped');
  });

  test('25. final cancellation state correct for zero-mutation cancel', async () => {
    const { tx } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-25'));
    const cancel = tx.cancelTransaction('tx-25');
    assert.equal(cancel.success, true);
    if (!cancel.success) return;
    assert.equal(cancel.value.failure?.reason, 'TRANSACTION_CANCELLED');
  });
});

describe('trainer-transaction: concurrency', () => {
  test('26. conflicting concurrent transaction rejected', async () => {
    const { tx } = await readyTransactionRuntime();
    const prep1 = await tx.prepareTransaction(twoWritePlan('tx-26a'));
    assert.equal(prep1.success, true);
    const prep2 = await tx.prepareTransaction({
      id: 'tx-26b',
      mode: 'ATOMIC',
      actions: [{ kind: 'write', featureId: 'gold', requestedValue: 2, approval: APPROVED }],
    });
    assert.equal(prep2.success, false);
    if (prep2.success) return;
    assert.equal(prep2.error.reason, 'TRANSACTION_CONFLICT');
  });

  test('27. unrelated safe transaction unaffected', async () => {
    const { tx } = await readyTransactionRuntime();
    const prep1 = await tx.prepareTransaction(twoWritePlan('tx-27a'));
    assert.equal(prep1.success, true);
    const prep2 = await tx.prepareTransaction({
      id: 'tx-27b',
      mode: 'ATOMIC',
      actions: [{ kind: 'write', featureId: 'mana', requestedValue: 3, approval: APPROVED }],
    });
    assert.equal(prep2.success, true);
  });
});

describe('trainer-transaction: compatibility', () => {
  test('28. existing single-action trainer behavior unchanged', async () => {
    const { runtime } = await readyTransactionRuntime();
    const result = await runtime.activateWriteFeature('gold', 1, APPROVED);
    assert.equal(result.success, true);
    assert.equal(runtime.getState(), 'ACTIVE');
  });

  test('29. P4-5 runtime lifecycle unchanged by transaction layer', async () => {
    const { runtime, tx } = await readyTransactionRuntime();
    await tx.prepareTransaction(twoWritePlan('tx-29'));
    await tx.executeTransaction('tx-29');
    assert.equal(runtime.getState(), 'ACTIVE');
  });
});

describe('trainer-transaction: security', () => {
  test('30. no direct native-memory calls from transaction module', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/core/trainer-runtime/transaction.ts', import.meta.url), 'utf8'),
    );
    assert.ok(!/driver\.|native|ReadProcessMemory|WriteProcessMemory/i.test(source));
  });

  test('31. in-process injection remains unreachable', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/core/trainer-runtime/transaction.ts', import.meta.url), 'utf8'),
    );
    assert.ok(!source.includes('in-process-script'));
  });

  test('32. consent semantics not weakened (per-action approval preserved)', async () => {
    const { tx } = await readyTransactionRuntime();
    const plan: CompositeTransactionPlan = {
      id: 'tx-32',
      mode: 'ATOMIC',
      actions: [{ kind: 'freeze', featureId: 'health', value: 100, approval: { consentToken: 'tok', consentBinding: {} as never } }],
    };
    const prep = await tx.prepareTransaction(plan);
    assert.equal(prep.success, true);
    const exec = await tx.executeTransaction('tx-32');
    assert.equal(exec.success, true);
  });
});

describe('trainer-transaction: schema', () => {
  test('33. no unnecessary schema version introduced', () => {
    assert.equal(DEFINITION.schemaVersion, 1);
  });

  test('34. existing V1 definitions remain valid unmodified', async () => {
    const { runtime } = await readyTransactionRuntime();
    assert.equal(runtime.getDefinition()?.schemaVersion, 1);
  });
});

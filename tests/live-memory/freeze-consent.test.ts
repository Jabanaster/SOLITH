import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FreezeConsentStore,
  LIVE_MEMORY_FREEZE_START_OPERATION,
  buildFreezeConsentBinding,
  redactFreezeConsentRecord,
} from '../../src/core/live-memory/freeze-consent.js';

const details = {
  operation: LIVE_MEMORY_FREEZE_START_OPERATION,
  pid: 1234,
  processIdentity: 'C:\\Games\\demo.exe',
  address: '0x1000',
  dataType: 'int32',
  value: 99,
  intervalMs: 200,
  maxDurationMs: 21_600_000,
  rendererId: 7,
};

function makeStore(now: () => number = () => 1_000, provider = () => true) {
  return new FreezeConsentStore({
    now,
    randomToken: () => 'a'.repeat(64),
    confirmationProvider: provider,
  });
}

async function issue(store = makeStore()) {
  const proposal = store.propose(details);
  const approval = await store.approve(proposal.proposalId, { rendererId: details.rendererId, confirm: true });
  assert.equal(approval.ok, true);
  if (!approval.ok) throw new Error('approval failed');
  return approval.tokenId;
}

describe('FreezeConsentStore', () => {
  test('requires an approval token and rejects malformed tokens', async () => {
    const store = makeStore();
    assert.deepEqual(store.consume('not-a-token', details), { ok: false, code: 'malformed' });
    const token = await issue(store);
    assert.equal(store.consume(token, details).ok, true);
  });

  test('expires tokens and rejects replay', async () => {
    let now = 1_000;
    const store = makeStore(() => now);
    const token = await issue(store);
    now += 60_001;
    assert.deepEqual(store.consume(token, details), { ok: false, code: 'expired' });
    assert.deepEqual(store.consume(token, details), { ok: false, code: 'replayed' });
  });

  test('binds PID, duration, operation, and renderer', async () => {
    const cases = [
      ['pid_mismatch', { ...details, pid: 9999 }],
      ['duration_mismatch', { ...details, maxDurationMs: 1 }],
      ['operation_mismatch', { ...details, operation: 'wrong-operation' as never }],
      ['target_mismatch', { ...details, address: '0x2000' }],
      ['renderer_mismatch', { ...details, rendererId: 8 }],
    ] as const;
    for (const [code, binding] of cases) {
      const store = makeStore();
      const token = await issue(store);
      assert.deepEqual(store.consume(token, {
        operation: binding.operation ?? LIVE_MEMORY_FREEZE_START_OPERATION,
        pid: binding.pid,
        processIdentity: binding.processIdentity,
        address: binding.address,
        dataType: binding.dataType,
        value: binding.value,
        intervalMs: binding.intervalMs,
        maxDurationMs: binding.maxDurationMs,
        rendererId: binding.rendererId,
      }), { ok: false, code });
    }
  });

  test('request binding rejects approved target, reattached PID, and renderer divergence', async () => {
    const store = makeStore();
    const token = await issue(store);
    const approvedRequest = buildFreezeConsentBinding({
      ...details,
      maxAllowedDurationMs: 21_600_000,
    });

    assert.deepEqual(
      store.consume(token, { ...approvedRequest, address: '0x2000', value: 9999, intervalMs: 500, maxDurationMs: 1_000 }),
      { ok: false, code: 'target_mismatch' },
    );

    const pidToken = await issue(store);
    assert.deepEqual(
      store.consume(pidToken, { ...approvedRequest, pid: 4321, processIdentity: 'C:\\Games\\other.exe' }),
      { ok: false, code: 'pid_mismatch' },
    );

    const rendererToken = await issue(store);
    assert.deepEqual(
      store.consume(rendererToken, { ...approvedRequest, rendererId: 99 }),
      { ok: false, code: 'renderer_mismatch' },
    );
  });

  test('caller boolean cannot bypass the confirmation provider', async () => {
    const store = makeStore(() => 1_000, () => false);
    const proposal = store.propose(details);
    assert.deepEqual(
      await store.approve(proposal.proposalId, { rendererId: details.rendererId, confirm: true }),
      { ok: false, code: 'confirmation_denied' },
    );
  });

  test('concurrent double-use permits exactly one success and consumes atomically', async () => {
    const store = makeStore();
    const token = await issue(store);
    const results = [store.consume(token, details), store.consume(token, details)];
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.deepEqual(results.find((result) => !result.ok), { ok: false, code: 'replayed' });
  });

  test('redacts token material in log rendering', async () => {
    const store = makeStore();
    const proposal = store.propose(details);
    const approval = await store.approve(proposal.proposalId, { rendererId: details.rendererId });
    assert.equal(approval.ok, true);
    if (!approval.ok) return;
    const rendered = JSON.stringify(redactFreezeConsentRecord(approval.record));
    assert.match(rendered, /aaaa…redacted/);
    assert.equal(rendered.includes(approval.tokenId), false);
  });

  test('retains replay detection for the configured window, then prunes it', async () => {
    let now = 1_000;
    const store = new FreezeConsentStore({
      now: () => now,
      ttlMs: 1_000,
      replayRetentionMs: 2_000,
      replayMaxEntries: 4,
      randomToken: () => 'b'.repeat(64),
      confirmationProvider: () => true,
    });
    const token = await issue(store);
    assert.equal(store.consume(token, details).ok, true);
    assert.deepEqual(store.consume(token, details), { ok: false, code: 'replayed' });
    now += 2_001;
    assert.deepEqual(store.consume(token, details), { ok: false, code: 'missing' });
  });
});

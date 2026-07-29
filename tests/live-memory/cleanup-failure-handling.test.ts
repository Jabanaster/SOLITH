import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup, type CleanupActions, type CleanupAuditEvent } from '../../src/core/live-memory/cleanup-coordinator.js';

function actions(overrides: Partial<CleanupActions> = {}) {
  const calls: string[] = [];
  const auditEvents: CleanupAuditEvent[] = [];
  const base: CleanupActions = {
    ownerId: '42',
    markRevoking: () => { calls.push('mark_revoking'); },
    blockFutureWrites: () => { calls.push('block_future_writes'); },
    revokeConsentTokens: () => { calls.push('revoke_consent_tokens'); },
    revokePendingProposals: () => { calls.push('revoke_pending_proposals'); },
    stopFreezeSchedulers: () => { calls.push('stop_freeze_schedulers'); },
    detachMemorySessions: () => { calls.push('detach_memory_sessions'); },
    clearRollbackRecords: () => { calls.push('clear_rollback_records'); },
    clearProcessSelections: () => { calls.push('clear_process_selection_records'); },
    removeTrustedWindowOwnership: () => { calls.push('remove_trusted_window_ownership'); },
    audit: (event) => { auditEvents.push(event); },
  };
  return { value: { ...base, ...overrides }, calls, auditEvents };
}

describe('cleanup failure containment', () => {
  test('runs the required cleanup order and records success', () => {
    const fixture = actions();
    const result = runCleanup(fixture.value);
    assert.equal(result.success, true);
    assert.deepEqual(fixture.calls, [
      'mark_revoking', 'block_future_writes', 'revoke_consent_tokens', 'revoke_pending_proposals',
      'stop_freeze_schedulers', 'detach_memory_sessions', 'clear_rollback_records',
      'clear_process_selection_records', 'remove_trusted_window_ownership',
    ]);
    assert.deepEqual(fixture.auditEvents, ['cleanup_started', 'cleanup_completed']);
  });

  test('contains multiple failures, continues every later step, and reports sanitized codes', () => {
    const fixture = actions({
      revokeConsentTokens: () => { fixture.calls.push('revoke_consent_tokens'); throw new Error('secret token and C:\\private\\game.exe'); },
      detachMemorySessions: () => { fixture.calls.push('detach_memory_sessions'); throw new Error('raw memory value 9999'); },
    });
    const result = runCleanup(fixture.value);
    assert.equal(result.success, false);
    assert.equal(fixture.calls.length, 9);
    assert.deepEqual(result.failedSteps, [
      { step: 'revoke_consent_tokens', errorCode: 'cleanup_step_failed' },
      { step: 'detach_memory_sessions', errorCode: 'cleanup_step_failed' },
    ]);
    assert.deepEqual(fixture.auditEvents, ['cleanup_started', 'cleanup_failed']);
    assert.doesNotMatch(JSON.stringify(result), /secret|private|game\.exe|9999/i);
  });

  test('audit failure cannot prevent the revocation barrier or remaining cleanup', () => {
    const fixture = actions({ audit: () => { throw new Error('audit unavailable'); } });
    const result = runCleanup(fixture.value);
    assert.equal(fixture.calls[0], 'mark_revoking');
    assert.equal(fixture.calls[1], 'block_future_writes');
    assert.equal(fixture.calls.length, 9);
    assert.equal(result.success, false);
    assert.deepEqual(result.failedSteps, [{ step: 'record_final_audit_result', errorCode: 'cleanup_step_failed' }]);
  });
});

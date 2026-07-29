export interface CleanupResult {
  success: boolean;
  completedSteps: string[];
  failedSteps: Array<{ step: string; errorCode: string }>;
}

export type CleanupAuditEvent = 'cleanup_started' | 'cleanup_completed' | 'cleanup_failed';
export type CleanupAuditSink = (event: CleanupAuditEvent, detail: { ownerId: string; failedSteps: string[] }) => void;

export interface CleanupActions {
  ownerId: string;
  markRevoking(): void;
  blockFutureWrites(): void;
  revokeConsentTokens(): void;
  revokePendingProposals(): void;
  stopFreezeSchedulers(): void;
  detachMemorySessions(): void;
  clearRollbackRecords(): void;
  clearProcessSelections(): void;
  removeTrustedWindowOwnership(): void;
  audit: CleanupAuditSink;
}

const SAFE_ERROR_CODE = 'cleanup_step_failed';

export function runCleanup(actions: CleanupActions): CleanupResult {
  const result: CleanupResult = { success: true, completedSteps: [], failedSteps: [] };
  const record = (step: string, action: () => void): void => {
    try {
      action();
      result.completedSteps.push(step);
    } catch {
      result.success = false;
      result.failedSteps.push({ step, errorCode: SAFE_ERROR_CODE });
    }
  };

  try { actions.audit('cleanup_started', { ownerId: actions.ownerId, failedSteps: [] }); } catch { /* continue */ }
  record('mark_revoking', actions.markRevoking);
  record('block_future_writes', actions.blockFutureWrites);
  record('revoke_consent_tokens', actions.revokeConsentTokens);
  record('revoke_pending_proposals', actions.revokePendingProposals);
  record('stop_freeze_schedulers', actions.stopFreezeSchedulers);
  record('detach_memory_sessions', actions.detachMemorySessions);
  record('clear_rollback_records', actions.clearRollbackRecords);
  record('clear_process_selection_records', actions.clearProcessSelections);
  record('remove_trusted_window_ownership', actions.removeTrustedWindowOwnership);

  const finalEvent = result.success ? 'cleanup_completed' : 'cleanup_failed';
  try {
    actions.audit(finalEvent, { ownerId: actions.ownerId, failedSteps: result.failedSteps.map((entry) => entry.step) });
    result.completedSteps.push('record_final_audit_result');
  } catch {
    result.success = false;
    result.failedSteps.push({ step: 'record_final_audit_result', errorCode: SAFE_ERROR_CODE });
  }
  return result;
}

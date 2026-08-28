import React, { useCallback, useEffect, useState } from 'react';
import { WispConsentDialog } from './WispConsentDialog.js';

/**
 * Adaptive Wisp Phase 1 — consent queue container (Section 17).
 *
 * Mount once near the app root. Shows AT MOST one consent dialog at a time
 * (queue policy: oldest pending proposal first — `createdAt` ascending);
 * additional pending proposals simply wait their turn. Re-fetches the full
 * pending list from the backend on every `queue-changed` push and on mount
 * (Section 26: "renderer reload and pending-state resynchronization") —
 * never trusts a locally-accumulated list, since the backend is the sole
 * authority on what is actually still pending.
 */
export function WispConsentQueue() {
  const [pending, setPending] = useState<WispConsentProposalViewShape[]>([]);

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.wispConsentListPending();
    setPending(result.success && result.proposals ? [...result.proposals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []);
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribeQueue = window.electronAPI.onWispConsentQueueChanged(() => refresh());
    const unsubscribeUpdated = window.electronAPI.onWispConsentProposalUpdated(() => refresh());
    return () => {
      unsubscribeQueue();
      unsubscribeUpdated();
    };
  }, [refresh]);

  const current = pending[0];
  if (!current) return null;

  return (
    <WispConsentDialog
      proposal={current}
      onApprove={async (proposalId) => {
        const result = await window.electronAPI.wispConsentApprove({ proposalId });
        await refresh();
        return { ok: result.success && result.executionStatus !== undefined && !['rejected', 'stale', 'unavailable', 'failed'].includes(result.executionStatus), message: result.message ?? result.error };
      }}
      onReject={(proposalId) => {
        window.electronAPI.wispConsentReject({ proposalId }).then(refresh);
      }}
      onCancel={(proposalId) => {
        window.electronAPI.wispConsentCancel({ proposalId }).then(refresh);
      }}
    />
  );
}

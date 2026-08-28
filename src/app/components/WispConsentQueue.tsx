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
 *
 * `active` is deliberately "sticky": once a proposal is shown, it stays
 * shown — even after it leaves the backend's pending list — until the user
 * closes it. A same-tick refresh() right after approve()/reject() would
 * otherwise remove the just-decided proposal from `pending` and unmount the
 * dialog before its own success/failure state (Section 16's live-region
 * outcome announcement) ever rendered. `pending` still drives which
 * proposal gets picked up NEXT.
 */
export function WispConsentQueue() {
  const [pending, setPending] = useState<WispConsentProposalViewShape[]>([]);
  const [active, setActive] = useState<WispConsentProposalViewShape | null>(null);

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

  useEffect(() => {
    if (active) return;
    if (pending[0]) setActive(pending[0]);
  }, [pending, active]);

  const dismissAndAdvance = useCallback(
    (proposalId: string, action: (payload: { proposalId: string }) => Promise<unknown>) => {
      action({ proposalId }).finally(() => {
        setActive(null);
        refresh();
      });
    },
    [refresh],
  );

  if (!active) return null;

  return (
    <WispConsentDialog
      proposal={active}
      onApprove={async (proposalId) => {
        const result = await window.electronAPI.wispConsentApprove({ proposalId });
        return {
          ok: result.success && result.executionStatus !== undefined && !['rejected', 'stale', 'unavailable', 'failed'].includes(result.executionStatus),
          message: result.message ?? result.error,
        };
      }}
      onReject={(proposalId) => dismissAndAdvance(proposalId, window.electronAPI.wispConsentReject)}
      onCancel={(proposalId) => dismissAndAdvance(proposalId, window.electronAPI.wispConsentCancel)}
    />
  );
}

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
 * `active` is deliberately sticky for the dialog's OWN decision (approve,
 * reject, cancel, or letting it sit until expiry) — the dialog's internal
 * `phase` state (idle/processing/succeeded/failed, see WispConsentDialog.tsx)
 * is what shows the terminal outcome, and it must survive `pending`
 * refreshing out from under it; the dialog itself owns dismissal via its own
 * Reject/Cancel/"OK" buttons.
 *
 * The ONE case that must close it WITHOUT the user acting: an external
 * lifecycle event (a real detach, reattach, process replacement,
 * session-generation change, or canonical-game switch — Phase 2
 * lifecycle-evidence closeout, SOLITH.MD Section 5) invalidating the
 * currently-shown proposal out from under the dialog. That is
 * distinguishable from every other terminal transition by the backend's own
 * `status` field: `handlePresentationStateReset()` (consent-service.ts) is
 * the ONLY code path that ever sets a proposal's status to `'invalidated'` —
 * every user-driven outcome (approved/succeeded/failed/rejected/cancelled/
 * expired/consumed) is left alone here.
 */
export function WispConsentQueue() {
  const [pending, setPending] = useState<WispConsentProposalViewShape[]>([]);
  const [active, setActive] = useState<WispConsentProposalViewShape | null>(null);

  const refresh = useCallback(async () => {
    const result = await window.electronAPI.wispConsentListPending();
    setPending(result.success && result.proposals ? [...result.proposals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []);
  }, []);

  const checkActiveForExternalInvalidation = useCallback(async (proposalId: string) => {
    const result = await window.electronAPI.wispConsentGet({ proposalId });
    const status = result.success ? result.proposal?.status : undefined;
    if (status === 'invalidated') {
      setActive((current) => (current?.proposalId === proposalId ? null : current));
    }
  }, []);

  useEffect(() => {
    const recheckActive = () => {
      refresh();
      setActive((current) => {
        if (current) void checkActiveForExternalInvalidation(current.proposalId);
        return current;
      });
    };
    recheckActive();
    const unsubscribeQueue = window.electronAPI.onWispConsentQueueChanged(() => recheckActive());
    const unsubscribeUpdated = window.electronAPI.onWispConsentProposalUpdated(() => recheckActive());
    return () => {
      unsubscribeQueue();
      unsubscribeUpdated();
    };
  }, [refresh, checkActiveForExternalInvalidation]);

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

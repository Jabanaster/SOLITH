import React, { useEffect, useRef, useState } from 'react';

/**
 * Adaptive Wisp Phase 1 — production consent dialog (Section 16).
 *
 * Shown for exactly one pending `WispConsentProposalViewShape` at a time
 * (queue policy: `WispConsentQueue`, the container component below, only
 * ever renders the oldest still-pending proposal). Every value shown here —
 * game id, action id, safe description, expiration — comes from the backend
 * proposal; nothing is computed or guessed in the renderer.
 *
 * Accessibility (Section 16): focus-trapped `alertdialog`, Escape rejects
 * (never approves), window/overlay click cancels, Approve/Reject are
 * visually distinct (not just color — separate icons/weight), the approve
 * button disables immediately on click and never re-enables mid-flight, and
 * a live region announces the outcome for screen readers.
 */

export interface WispConsentDialogProps {
  proposal: WispConsentProposalViewShape;
  onApprove: (proposalId: string) => Promise<{ ok: boolean; message?: string }>;
  onReject: (proposalId: string) => void;
  onCancel: (proposalId: string) => void;
}

type Phase = 'idle' | 'processing' | 'succeeded' | 'failed';

function formatCountdown(expiresAt: string, nowMs: number): string {
  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (remainingMs <= 0) return 'expired';
  return `${Math.ceil(remainingMs / 1000)}s`;
}

export function WispConsentDialog({ proposal, onApprove, onReject, onCancel }: WispConsentDialogProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const approveButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const overlay = overlayRef.current;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    // Reject, not Approve, gets initial focus (Section 16: "No approval button
    // may receive automatic focus if Enter could accidentally approve").
    overlay?.querySelector<HTMLElement>('[data-wisp-consent-reject]')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!overlay) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (phase === 'idle') onCancel(proposal.proposalId);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = overlay.querySelectorAll<HTMLElement>(focusableSelector);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isExpired = nowMs >= new Date(proposal.expiresAt).getTime();
  const isDone = phase === 'succeeded' || phase === 'failed';

  async function handleApprove() {
    if (phase !== 'idle' || isExpired) return;
    setPhase('processing');
    const result = await onApprove(proposal.proposalId);
    setPhase(result.ok ? 'succeeded' : 'failed');
    setResultMessage(result.message ?? (result.ok ? 'Applied.' : 'The change could not be applied.'));
  }

  function handleReject() {
    if (phase !== 'idle') return;
    onReject(proposal.proposalId);
  }

  return (
    <div
      ref={overlayRef}
      className="dialog-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="wisp-consent-title"
      aria-describedby="wisp-consent-description"
      onClick={() => phase === 'idle' && onCancel(proposal.proposalId)}
    >
      <div className="dialog-box" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h3 id="wisp-consent-title">Approve memory change</h3>
        </div>
        <div className="dialog-body">
          <p id="wisp-consent-description">{proposal.safeDescription}</p>
          <dl className="wisp-consent-details">
            <dt>Game</dt>
            <dd>{proposal.canonicalGameId}</dd>
            <dt>Operation</dt>
            <dd>{proposal.operationType === 'freeze' ? 'Repeated write (freeze)' : 'Single write'}</dd>
            <dt>Expires</dt>
            <dd aria-live="polite">{isExpired ? 'expired' : formatCountdown(proposal.expiresAt, nowMs)}</dd>
          </dl>
          <div role="status" aria-live="polite">
            {phase === 'processing' && 'Applying…'}
            {isDone && resultMessage}
            {isExpired && phase === 'idle' && 'This proposal has expired.'}
          </div>
        </div>
        <div className="dialog-actions">
          {!isDone && (
            <>
              <button type="button" data-wisp-consent-reject className="btn-secondary" onClick={handleReject} disabled={phase === 'processing'}>
                Reject
              </button>
              <button
                ref={approveButtonRef}
                type="button"
                className="btn-primary btn-risky"
                onClick={handleApprove}
                disabled={phase === 'processing' || isExpired}
              >
                Approve
              </button>
            </>
          )}
          {isDone && (
            <button type="button" className="btn-secondary" onClick={() => onCancel(proposal.proposalId)}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

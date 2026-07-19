import React, { useEffect, useRef } from 'react';

export function CommunityExecutionDialog({
  cheatName,
  onProceed,
  onCancel,
}: {
  cheatName: string;
  onProceed: () => void;
  onCancel: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const overlay = overlayRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    overlay?.querySelector<HTMLElement>(focusableSelector)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!overlay) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
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
  }, []);

  return (
    <div
      ref={overlayRef}
      className="dialog-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="community-execution-title"
      aria-describedby="community-execution-description"
      onClick={() => onCancelRef.current()}
    >
      <div className="dialog-box" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h3 id="community-execution-title">Community definition warning</h3>
          <button
            type="button"
            className="dialog-close"
            onClick={() => onCancelRef.current()}
            aria-label="Cancel community definition execution"
          >
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <div className="dialog-warning">
            <strong>{cheatName}</strong>
          </div>
          <p id="community-execution-description">
            This definition has not been verified by Solith. Executing it requires an
            active memory scan. Proceed?
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={() => onCancelRef.current()}>
            Cancel
          </button>
          <button type="button" className="btn-primary btn-risky" onClick={onProceed}>
            Proceed with scan
          </button>
        </div>
      </div>
    </div>
  );
}

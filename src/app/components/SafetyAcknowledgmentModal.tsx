import React, { useEffect, useRef } from 'react';
import {
  SAFETY_ACK_TITLE,
  SAFETY_ACK_BODY_PARAGRAPHS,
  SAFETY_ACK_FOOTNOTE,
  SAFETY_ACK_BUTTON_LABEL,
} from '../../core/safety-acknowledgment/copy.js';

/**
 * Offline Safety Acknowledgment — Policy v1 (Core Product Completion,
 * BLOCKER-01). Owner-frozen copy and behavior — do not reword without a
 * policy-version bump decision (see src/core/safety-acknowledgment/policy.ts).
 *
 * This is UX, not authorization. Runtime safety gates (AuthorityService,
 * attach/read/write/freeze, protected-target checks) are completely
 * independent of this component and of whatever is persisted here — see
 * tests/safety-acknowledgment-runtime-independence.test.ts.
 *
 * Rendered as the ONLY content in the app shell while acknowledgment is
 * required (see App.tsx) — there is nothing behind it to tab or click into,
 * which is what makes it un-bypassable rather than a focus-trap on its own.
 * Escape is explicitly a no-op: closing this dialog is only possible by
 * pressing the single acknowledgment button.
 */
export interface SafetyAcknowledgmentModalProps {
  onAcknowledge: () => void;
  busy?: boolean;
}

export const SafetyAcknowledgmentModal: React.FC<SafetyAcknowledgmentModalProps> = ({ onAcknowledge, busy }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-ack-title"
      className="safety-ack-overlay"
      // Escape must never dismiss this — there is no dismiss path other
      // than the acknowledgment button, and no element behind this overlay
      // to tab into (App.tsx renders nothing else while this is shown).
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.preventDefault();
      }}
    >
      <div className="safety-ack-dialog">
        <h1 id="safety-ack-title" className="safety-ack-title">
          {SAFETY_ACK_TITLE}
        </h1>
        {SAFETY_ACK_BODY_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p className="safety-ack-footnote">{SAFETY_ACK_FOOTNOTE}</p>
        <div className="safety-ack-actions">
          <button ref={buttonRef} type="button" className="btn-primary" onClick={onAcknowledge} disabled={busy}>
            {SAFETY_ACK_BUTTON_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SafetyAcknowledgmentModal;

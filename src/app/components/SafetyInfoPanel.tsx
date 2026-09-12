import React from 'react';
import {
  SAFETY_ACK_TITLE,
  SAFETY_ACK_BODY_PARAGRAPHS,
  SAFETY_ACK_FOOTNOTE,
} from '../../core/safety-acknowledgment/copy.js';

/**
 * Mission 6 — read-only "Safety Info" view (reachable from the reminder
 * banner or Settings). Shows the same frozen copy as the blocking
 * acknowledgment dialog, but closing it does NOT record an acknowledgment
 * or touch safetyAckState/safetyAckAt/safetyReminderDismissedAt in any way —
 * this is purely informational.
 */
export interface SafetyInfoPanelProps {
  onClose: () => void;
}

export const SafetyInfoPanel: React.FC<SafetyInfoPanelProps> = ({ onClose }) => {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="safety-info-title" className="safety-ack-overlay">
      <div className="safety-ack-dialog">
        <h2 id="safety-info-title" className="safety-ack-title">
          {SAFETY_ACK_TITLE}
        </h2>
        {SAFETY_ACK_BODY_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p className="safety-ack-footnote">{SAFETY_ACK_FOOTNOTE}</p>
        <div className="safety-ack-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SafetyInfoPanel;

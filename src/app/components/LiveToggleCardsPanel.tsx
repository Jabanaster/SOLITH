import React, { useCallback, useState } from 'react';
import type { LiveToggleCard } from '../../core/live-memory/ct-promote.js';

export interface LiveToggleCardsPanelProps {
  attached: boolean;
  cards: LiveToggleCard[];
  /** Resolve module path → absolute address via session-bound IPC. */
  onResolve?: (card: LiveToggleCard) => Promise<string | null>;
  onFreeze?: (address: string, value: number, dataType: string) => Promise<void>;
  onStopFreeze?: () => Promise<void>;
  freezeActive?: boolean;
}

/**
 * Phase 2 — WeMod-style toggle cards from resolvable CT / definition pointers.
 * Freeze uses existing RPM/WPM freeze loop only (no AA).
 */
export const LiveToggleCardsPanel: React.FC<LiveToggleCardsPanelProps> = ({
  attached,
  cards,
  onResolve,
  onFreeze,
  onStopFreeze,
  freezeActive = false,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const toggle = useCallback(
    async (card: LiveToggleCard) => {
      if (!attached) {
        setMessage('Attach a process first.');
        return;
      }
      if (!card.freezeEligible) {
        setMessage(`${card.label}: absolute-only / incomplete — watch only, freeze disabled.`);
        return;
      }
      if (freezeActive && activeCardId === card.id) {
        setBusyId(card.id);
        try {
          await onStopFreeze?.();
          setActiveCardId(null);
          setMessage(`Stopped freeze: ${card.label}`);
        } finally {
          setBusyId(null);
        }
        return;
      }
      setBusyId(card.id);
      try {
        const address = (await onResolve?.(card)) ?? null;
        if (!address) {
          setMessage(`Could not resolve ${card.label}`);
          return;
        }
        await onFreeze?.(address, card.defaultValue, card.dataType);
        setActiveCardId(card.id);
        setMessage(`Freeze on: ${card.label} @ ${address}`);
      } catch (e) {
        setMessage(String(e));
      } finally {
        setBusyId(null);
      }
    },
    [activeCardId, attached, freezeActive, onFreeze, onResolve, onStopFreeze],
  );

  if (cards.length === 0) return null;

  return (
    <section className="v2-monitor-section" aria-label="Live toggle cards">
      <h3>Live Toggle Cards</h3>
      <p className="v2-meta">
        Auto-generated from resolvable pointer paths. Freeze = continuous WriteProcessMemory only —
        no Auto Assembler / DLL inject.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {cards.map((card) => (
          <li
            key={card.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              border: '1px solid var(--border, #444)',
              padding: '8px 12px',
              borderRadius: 6,
            }}
          >
            <div>
              <strong>{card.label}</strong>
              <div className="v2-meta">
                {card.liveResolution}
                {card.freezeEligible ? '' : ' · watch-only'} · {card.moduleName}+{card.baseOffset}
              </div>
            </div>
            <button
              type="button"
              className={activeCardId === card.id && freezeActive ? 'btn-danger' : 'btn-primary'}
              disabled={!attached || busyId === card.id || (!card.freezeEligible && !(activeCardId === card.id))}
              onClick={() => void toggle(card)}
            >
              {activeCardId === card.id && freezeActive ? 'Stop' : card.freezeEligible ? 'Infinite' : 'N/A'}
            </button>
          </li>
        ))}
      </ul>
      {message && (
        <p className="v2-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
};

export default LiveToggleCardsPanel;

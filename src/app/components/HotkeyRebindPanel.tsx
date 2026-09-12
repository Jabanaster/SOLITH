import React, { useCallback, useEffect, useState } from 'react';
import styles from './HotkeyRebindPanel.module.css';

const SLOT_LABELS: Record<string, string> = {
  toggle_overlay: 'Toggle overlay',
  hide_overlay: 'Hide overlay',
};
for (let i = 1; i <= 12; i += 1) {
  SLOT_LABELS[`cheat_slot_${i}`] = `Cheat slot F${i}`;
}

export const HotkeyRebindPanel: React.FC = () => {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Array<{ accelerator: string; actions: string[] }>>([]);
  const [osWarnings, setOsWarnings] = useState<Array<{ accelerator: string; action: string; reason: string }>>([]);
  const [unavailable, setUnavailable] = useState<Array<{ action: string; accelerator: string; reason: string }>>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.trainerHotkeysGetBindings) {
      const fallback = await api?.trainerHotkeysGetDefaults?.();
      if (fallback?.hotkeys) setBindings(fallback.hotkeys);
      return;
    }
    const result = await api.trainerHotkeysGetBindings();
    if (result?.hotkeys) setBindings(result.hotkeys);
    if (result?.conflicts) setConflicts(result.conflicts);
    if (result?.osWarnings) setOsWarnings(result.osWarnings);

    const status = await api.trainerHotkeysGetStatus?.();
    if (status?.failed) setUnavailable(status.failed);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChange = (action: string, value: string) => {
    setBindings((prev) => ({ ...prev, [action]: value }));
  };

  const handleSave = async () => {
    const api = window.electronAPI;
    if (!api?.trainerHotkeysSetBindings) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.trainerHotkeysSetBindings({ hotkeys: bindings });
      if (result?.success) {
        setBindings(result.hotkeys ?? bindings);
        setConflicts(result.conflicts ?? []);
        setOsWarnings(result.osWarnings ?? []);
        const status = await api.trainerHotkeysGetStatus?.();
        if (status?.failed) setUnavailable(status.failed);
        setMessage(
          result.conflicts?.length
            ? 'Saved with conflicts — resolve duplicate keys.'
            : result.osWarnings?.length
              ? 'Saved — review OS shortcut warnings below.'
              : 'Hotkeys saved.',
        );
      } else {
        setMessage(result?.error ?? 'Failed to save hotkeys.');
      }
    } finally {
      setBusy(false);
    }
  };

  const actions = Object.keys(bindings).sort((a, b) => {
    if (a === 'toggle_overlay') return -1;
    if (b === 'toggle_overlay') return 1;
    return a.localeCompare(b);
  });

  return (
    <section className={styles.panel} aria-label="Hotkey bindings">
      <h3 className={styles.title}>Hotkey bindings</h3>
      <p className={styles.hint}>
        Rebind global trainer shortcuts. Use Electron accelerator syntax (e.g. F5, Control+Shift+O).
      </p>
      <ul className={styles.list}>
        {actions.map((action) => {
          const failure = unavailable.find((entry) => entry.action === action);
          return (
            <li key={action} className={styles.row}>
              <label htmlFor={`hk-${action}`}>
                {SLOT_LABELS[action] ?? action}
                {failure && ' — Unassigned / needs remap'}
              </label>
              <input
                id={`hk-${action}`}
                type="text"
                value={bindings[action] ?? ''}
                onChange={(e) => handleChange(action, e.target.value)}
                disabled={busy}
                aria-invalid={Boolean(failure)}
              />
            </li>
          );
        })}
      </ul>
      {conflicts.length > 0 && (
        <ul className={styles.conflicts} role="alert">
          {conflicts.map((c) => (
            <li key={c.accelerator}>
              Conflict: <code>{c.accelerator}</code> used by {c.actions.join(', ')}
            </li>
          ))}
        </ul>
      )}
      {unavailable.length > 0 && (
        <ul className={styles.conflicts} role="alert">
          {unavailable.map((entry) => (
            <li key={`${entry.action}-${entry.accelerator}`}>
              Unavailable: <code>{entry.accelerator}</code> ({SLOT_LABELS[entry.action] ?? entry.action}) — {entry.reason}
            </li>
          ))}
        </ul>
      )}
      {osWarnings.length > 0 && (
        <ul className={styles.conflicts} role="status">
          {osWarnings.map((w) => (
            <li key={`${w.action}-${w.accelerator}`}>
              OS note: <code>{w.accelerator}</code> ({SLOT_LABELS[w.action] ?? w.action}) — {w.reason}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} onClick={() => void handleSave()} disabled={busy}>
          Save hotkeys
        </button>
        {message && <span className={styles.message}>{message}</span>}
      </div>
    </section>
  );
};

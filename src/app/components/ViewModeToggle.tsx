import React, { useEffect, useState } from 'react';
import styles from './ViewModeToggle.module.css';

export type LibraryViewMode = 'grid' | 'list';

export interface ViewModeToggleProps {
  /** Called after the mode changes and is persisted, so parents can react without re-reading settings themselves. */
  onChange?: (mode: LibraryViewMode) => void;
}

function isLibraryViewMode(value: unknown): value is LibraryViewMode {
  return value === 'grid' || value === 'list';
}

/**
 * Two-state grid/list view toggle. Reads the persisted mode via the
 * `get-settings` IPC channel once at mount and writes changes via
 * `set-setting('libraryViewMode', ...)` (see electron/main.ts and
 * src/core/settings/index.ts) — parents never need to reimplement that
 * settings I/O themselves. This component is renderer-side, so it must go
 * through window.electronAPI rather than importing src/core/settings
 * directly (that module is main-process-only: it transitively pulls in
 * better-sqlite3 via src/core/database, which does not exist in the
 * browser/renderer bundle).
 */
export function ViewModeToggle({ onChange }: ViewModeToggleProps) {
  const [mode, setMode] = useState<LibraryViewMode>('grid');

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSettings().then((settings: { libraryViewMode?: unknown }) => {
      if (!cancelled && isLibraryViewMode(settings?.libraryViewMode)) {
        setMode(settings.libraryViewMode);
      }
    }).catch(() => {
      // Fall back to the 'grid' default already set above.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectMode = (next: LibraryViewMode) => {
    if (next === mode) return;
    setMode(next);
    onChange?.(next);
    void window.electronAPI.setSetting('libraryViewMode', next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectMode(mode === 'grid' ? 'list' : 'grid');
    }
  };

  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Library view mode" onKeyDown={handleKeyDown}>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'grid'}
        className={mode === 'grid' ? styles.optionActive : styles.option}
        onClick={() => selectMode('grid')}
      >
        Grid
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'list'}
        className={mode === 'list' ? styles.optionActive : styles.option}
        onClick={() => selectMode('list')}
      >
        List
      </button>
    </div>
  );
}

export default ViewModeToggle;

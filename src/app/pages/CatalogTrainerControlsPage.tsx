import React, { useCallback, useEffect, useState } from 'react';
import TrainerControlPanel from './TrainerControlPanel.js';
import type { TrainerControl } from '../../core/trainer-host/trainer-control-schema.js';
import type { CatalogDefinitionCapabilities } from '../../core/definitions/load-catalog-definition.js';

export default function CatalogTrainerControlsPage({
  catalogGameId,
  displayName,
}: {
  catalogGameId: string;
  displayName?: string;
}) {
  const [controls, setControls] = useState<TrainerControl[]>([]);
  const [capabilities, setCapabilities] = useState<CatalogDefinitionCapabilities | null>(null);
  const [saveFilePath, setSaveFilePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setMessage('');
      try {
        const result = await window.electronAPI?.trainerCatalogGetTrainerControls?.({ catalogGameId });
        if (cancelled) return;
        if (!result?.success || !result.controls) {
          setMessage(result?.error ?? 'Could not load save controls for this catalog entry.');
          setControls([]);
          return;
        }
        setControls(result.controls as TrainerControl[]);
        setCapabilities((result.capabilities as CatalogDefinitionCapabilities | undefined) ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogGameId]);

  const handleApproveSavePath = useCallback(async () => {
    if (!saveFilePath.trim()) return;
    const result = await window.electronAPI?.trainerCatalogApproveSavePath?.({
      catalogGameId,
      saveFilePath: saveFilePath.trim(),
    });
    if (!result?.success) {
      setMessage(result?.error ?? 'Could not approve save path.');
      return;
    }
    setMessage('Save path approved for this catalog game.');
  }, [catalogGameId, saveFilePath]);

  if (loading) {
    return <p className="catalog-controls-loading">Loading save controls…</p>;
  }

  if (!controls.length) {
    return <p className="catalog-controls-empty">{message || 'No save-backed controls in this definition.'}</p>;
  }

  return (
    <>
      {message && <p className="catalog-controls-message">{message}</p>}
      <TrainerControlPanel
        autoStart
        controls={controls}
        panelTitle={displayName ? `${displayName} — Save Controls` : 'Catalog Save Controls'}
        saveFilePath={saveFilePath}
        saveDirectoryHint={capabilities?.saveDirectoryHint}
        onSaveFilePathChange={setSaveFilePath}
        onApproveSavePath={handleApproveSavePath}
      />
    </>
  );
}

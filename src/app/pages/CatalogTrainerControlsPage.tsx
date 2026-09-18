import React, { useCallback, useEffect, useState } from 'react';
import TrainerControlPanel from './TrainerControlPanel.js';
import type { TrainerControl } from '../../core/trainer-host/trainer-control-schema.js';
import type { CatalogDefinitionCapabilities } from '../../core/definitions/catalog-definition-capabilities.js';
import type { TrainerDefinitionProvenance } from '../../core/trainer-storage/types.js';

export default function CatalogTrainerControlsPage({
  catalogGameId,
  displayName,
}: {
  catalogGameId: string;
  displayName?: string;
}) {
  const [controls, setControls] = useState<TrainerControl[]>([]);
  const [capabilities, setCapabilities] = useState<CatalogDefinitionCapabilities | null>(null);
  const [provenance, setProvenance] = useState<TrainerDefinitionProvenance | null>(null);
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
        setProvenance(result.provenance ?? null);
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
      {capabilities && (
        <p className="catalog-controls-caps" role="note">
          schema.v1 lanes (advisory): save=
          <strong>{capabilities.saveEdit}</strong>
          {', '}
          live=
          <strong>{capabilities.liveMemory}</strong>
          {', '}
          injection=
          <strong>{capabilities.injection}</strong>
          {capabilities.liveMemory === 'scan-required'
            ? ' — live features require Discovery (L0 scan_unknown), not verified pointers.'
            : ''}
        </p>
      )}
      {capabilities?.saveFormat === 'json' && (
        <p className="catalog-controls-format-note" role="note">
          JSON save format: edits use the JSON save-field router. Approve a concrete save file path before writing;
          binary or hex-only fields in this definition are not routed to TrainerHost.
        </p>
      )}
      {provenance && (
        <p className="catalog-controls-provenance" role="note">
          Source: <strong>{provenance.sourceProvider}</strong> ({provenance.certLevel})
          {provenance.migratedFromLegacy ? ' — migrated from legacy format' : ''}
          {provenance.conflictingSources.length > 0 ? (
            <>
              {' — '}
              {provenance.conflictingSources.length} other version
              {provenance.conflictingSources.length === 1 ? '' : 's'} of this trainer exist and were not used
              ({provenance.conflictingSources.map((c) => c.sourceProvider).join(', ')})
            </>
          ) : null}
        </p>
      )}
      {provenance?.conversionWarnings && provenance.conversionWarnings.length > 0 && (
        <p className="catalog-controls-conversion-warnings" role="note">
          Converted from a legacy format with {provenance.conversionWarnings.length} known
          {provenance.conversionWarnings.length === 1 ? ' limitation' : ' limitations'}:{' '}
          {provenance.conversionWarnings.join('; ')}
        </p>
      )}
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

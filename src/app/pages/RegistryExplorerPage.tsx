import React, { useMemo, useState } from 'react';
import type { CompiledCtRegistry } from '../../core/registry/loaded-registry.js';
import { validateLoadedRegistry } from '../../core/registry/loaded-registry.js';
import type { CtCompilerPipelineRegistry } from '../../core/registry/compile-ct-registry.js';
import type { RegistryResultType, RegistrySearchResult } from '../../core/registry/query-registry.js';
import { searchRegistry } from '../../core/registry/query-registry.js';
import type { L4CertificationTier, L4EntryEvidence } from '../../core/registry/l4-governance.js';
import { L4GovernancePanel } from '../components/L4GovernancePanel.js';
import { PageWalkthrough } from '../components/PageWalkthrough.js';

interface RegistryExplorerPageProps {
  registry?: CompiledCtRegistry | null;
}

const TYPE_OPTIONS: Array<'all' | RegistryResultType> = ['all', 'pointer', 'aob', 'script', 'rejection'];

interface RegistryVerificationArtifactView {
  requestId: string;
  readOnly: true;
  executable: false;
  process: { pid: number; executableName: string };
  summary: {
    aobSignatures: {
      byStatus: {
        unique_match: number;
        multiple_matches: number;
        no_match: number;
      };
    };
    pointers: {
      root_in_module_range: number;
      root_out_of_module_range: number;
      l2_resolved?: number;
      l2_unreadable?: number;
      l2_invalid_chain?: number;
      helper_unavailable?: number;
    };
  };
}

interface RestartComparisonView {
  previousSessionId: string;
  currentSessionId: string;
  summary: {
    restart_stable_unique: number;
    hash_changed: number;
    address_or_offset_changed: number;
    missing: number;
    not_unique: number;
  };
}

interface PointerStabilityView {
  promotedToL3: string[];
  unstableWarnings: string[];
  summary: {
    l3_stability_verified: number;
    executable_or_registry_changed: number;
    missing: number;
    not_l2_resolved: number;
    signature_changed: number;
    pointer_hops_changed: number;
    module_relative_offset_changed: number;
    resolved_region_changed: number;
    inconsistent: number;
  };
}

function excerpt(text: string, needle: string, size = 360): string {
  if (!needle) return text.slice(0, size);
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return text.slice(0, size);
  const start = Math.max(0, index - 80);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + size)}${start + size < text.length ? '…' : ''}`;
}

function DetailPanel({ result, query }: { result: RegistrySearchResult | null; query: string }) {
  if (!result) {
    return (
      <section className="panel-card" aria-label="Registry detail">
        <h3>Select a registry result</h3>
        <p>Pointer, AOB, script, and rejection records stay read-only. Imported CE scripts are displayed as text only.</p>
      </section>
    );
  }

  const scriptText =
    result.type === 'script' && 'raw_script_content' in result.entry
      ? result.entry.raw_script_content
      : null;

  const rejectionReason =
    result.type === 'rejection' && result.entry && typeof result.entry === 'object' && 'reason' in result.entry
      ? String((result.entry as { reason?: string }).reason ?? result.description)
      : null;

  return (
    <section className="panel-card" aria-label="Registry detail">
      <h3>{result.title}</h3>
      <p className="muted">{result.type.toUpperCase()} · executable={String(result.executable)}</p>
      <dl className="kv-grid">
        <dt>Source entry</dt>
        <dd>{result.source.sourceEntryDescription}</dd>
        <dt>Module</dt>
        <dd>{result.module ?? '—'}</dd>
        <dt>Scan type</dt>
        <dd>{result.scanType ?? '—'}</dd>
        <dt>Value type</dt>
        <dd>{result.valueType ?? '—'}</dd>
        <dt>Line</dt>
        <dd>{result.source.lineNumber ?? '—'}</dd>
        <dt>Warnings</dt>
        <dd>{result.warnings.length ? result.warnings.join('; ') : 'none'}</dd>
        {result.duplicateOf ? (
          <>
            <dt>Duplicate of</dt>
            <dd>{result.duplicateOf}</dd>
          </>
        ) : null}
      </dl>
      {result.pattern && (
        <>
          <h4>AOB pattern</h4>
          <code>{result.pattern}</code>
          <h4>Normalized</h4>
          <code>{result.normalizedPattern}</code>
        </>
      )}
      {rejectionReason && (
        <>
          <h4>Rejection reason</h4>
          <p>{rejectionReason}</p>
        </>
      )}
      <p className="safety-note">
        Imported CE scripts and AOB metadata are displayed only; Solith does not execute Auto Assembler text here.
      </p>
      {scriptText && (
        <>
          <h4>Original inert script excerpt</h4>
          <pre className="script-preview">{excerpt(scriptText, query)}</pre>
        </>
      )}
    </section>
  );
}

function GovernanceDashboard({
  pipeline,
  registry,
}: {
  pipeline?: CtCompilerPipelineRegistry;
  registry: CompiledCtRegistry;
}) {
  const [pidText, setPidText] = useState('');
  const [executableName, setExecutableName] = useState('');
  const [running, setRunning] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [artifact, setArtifact] = useState<RegistryVerificationArtifactView | null>(null);
  const [artifactPath, setArtifactPath] = useState('');
  const [previousArtifact, setPreviousArtifact] = useState<unknown | null>(null);
  const [restartComparison, setRestartComparison] = useState<RestartComparisonView | null>(null);
  const [pointerStability, setPointerStability] = useState<PointerStabilityView | null>(null);

  const runVerification = async () => {
    setVerificationError('');
    setRestartComparison(null);
    setPointerStability(null);
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 0) {
      setVerificationError('Enter the explicitly selected process PID.');
      return;
    }
    if (!executableName.trim()) {
      setVerificationError('Enter the executable name for the selected PID.');
      return;
    }
    if (!window.electronAPI?.registryRunReadOnlyVerification || !window.electronAPI?.registrySelectProcess) {
      setVerificationError('Read-only registry verification is only available inside Electron.');
      return;
    }

    setRunning(true);
    try {
      // Batch B1.1: the main process independently re-verifies this pid/executableName
      // against the live OS process before creating a selection — the renderer's input
      // is no longer trusted directly, only used to REQUEST a selection.
      const selection = await window.electronAPI.registrySelectProcess({
        pid,
        executableName: executableName.trim(),
      });
      if (!selection.success || !selection.selectionId) {
        setVerificationError(selection.error ?? 'Could not select the specified process.');
        return;
      }
      const response = await window.electronAPI.registryRunReadOnlyVerification({
        registry,
        selectionId: selection.selectionId,
        timeoutMs: 30_000,
      });
      if (!response.success || !response.artifact) {
        setVerificationError(response.error ?? 'Read-only verification failed.');
        return;
      }
      setArtifact(response.artifact);
      setArtifactPath(response.artifactPath ?? '');
    } finally {
      setRunning(false);
    }
  };

  const onLoadPreviousArtifact = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        setPreviousArtifact(parsed);
        setRestartComparison(null);
        setPointerStability(null);
        setVerificationError('');
      } catch (error) {
        setPreviousArtifact(null);
        setVerificationError(error instanceof Error ? error.message : String(error));
      }
    };
    reader.onerror = () => setVerificationError('Could not read the previous verification artifact.');
    reader.readAsText(file);
  };

  const compareRestart = async () => {
    setVerificationError('');
    if (!previousArtifact || !artifact) {
      setVerificationError('Load a previous artifact and run a current verification before comparing restart stability.');
      return;
    }
    if (!window.electronAPI?.registryCompareRestartArtifacts) {
      setVerificationError('Restart comparison is only available inside Electron.');
      return;
    }
    const response = await window.electronAPI.registryCompareRestartArtifacts({
      previous: previousArtifact,
      current: artifact,
    });
    if (!response.success || !response.comparison) {
      setVerificationError(response.error ?? 'Restart comparison failed.');
      return;
    }
    setRestartComparison(response.comparison);
    setPointerStability(response.pointerStability ?? null);
  };

  const verificationSummary = artifact?.summary.aobSignatures.byStatus;

  if (!pipeline) {
    return (
      <section className="panel-card" aria-label="Governance dashboard">
        <h3>Governance dashboard</h3>
        <p className="muted">This registry does not include the v1.2 pipeline projection yet.</p>
        <p className="safety-note">Legacy registries remain searchable, but they cannot claim L2/L3 governance state.</p>
      </section>
    );
  }

  const quarantinedScripts = pipeline.script_catalog_refs.filter((script) => script.rejection_flags.length > 0);
  const l3StableEntryIds = new Set(pointerStability?.promotedToL3 ?? []);
  const l4Entries: L4EntryEvidence[] = pipeline.entries.map((entry) => {
    const l3Stable = l3StableEntryIds.has(entry.ct_entry_id);
    const pointerChain = [
      entry.address_data.root_offset ?? entry.address_data.raw_address,
      ...entry.address_data.pointer_chain,
    ].filter((segment): segment is string => Boolean(segment));

    return {
      ctEntryId: entry.ct_entry_id,
      label: entry.label,
      certificationTier: (l3Stable ? 'L3' : entry.entry_state.current_tier) as L4CertificationTier,
      moduleTarget: entry.address_data.base,
      pointerChain,
      valueType: entry.type,
      l3ArtifactHash: l3Stable ? pipeline.source.sha256 : undefined,
    };
  });

  return (
    <section className="panel-card" aria-label="Governance dashboard">
      <div className="split-header">
        <div>
          <p className="eyebrow">Zero-trust governance</p>
          <h3>{pipeline.source.file}</h3>
          <p className="muted">
            Provenance: {pipeline.source.kind}
            {pipeline.source.user_certified ? ' · user-certified intent recorded' : ''}
          </p>
        </div>
        <div>
          <span className="status-pill">{pipeline.global_status.certification_level}</span>
          <p className="muted">{pipeline.global_status.verification_cycles_completed} verification cycles</p>
        </div>
      </div>

      <dl className="kv-grid">
        <dt>Pipeline schema</dt>
        <dd>{pipeline.schema_version}</dd>
        <dt>Source hash</dt>
        <dd>{pipeline.source.sha256.slice(0, 16)}…</dd>
        <dt>Entries</dt>
        <dd>{pipeline.entries.length}</dd>
        <dt>AOB signatures</dt>
        <dd>{pipeline.aob_signatures.length}</dd>
        <dt>Quarantined scripts</dt>
        <dd>{quarantinedScripts.length}</dd>
        <dt>Warnings</dt>
        <dd>{pipeline.warnings.length}</dd>
      </dl>

      {pipeline.entries.length > 0 && (
        <>
          <h4>Entry gates</h4>
          <div className="result-stack">
            {pipeline.entries.slice(0, 8).map((entry) => (
              <div className="result-row-static" key={entry.ct_entry_id}>
                <span>{entry.entry_state.current_tier}</span>
                <strong>{entry.label}</strong>
                <small>
                  {entry.address_data.base} · {entry.address_data.pointer_chain.length} pointer offsets · executable=false
                </small>
              </div>
            ))}
          </div>
        </>
      )}

      {pipeline.aob_signatures.length > 0 && (
        <>
          <h4>Read-only AOB research</h4>
          <div className="result-stack">
            {pipeline.aob_signatures.slice(0, 8).map((signature) => (
              <div className="result-row-static" key={signature.aob_id}>
                <span>{signature.scan_type}</span>
                <strong>{signature.symbol}</strong>
                <small>
                  {signature.module_target ?? 'module-less'} · {signature.pattern}
                </small>
              </div>
            ))}
          </div>
        </>
      )}

      {quarantinedScripts.length > 0 && (
        <>
          <h4>Quarantined script catalog</h4>
          <div className="result-stack">
            {quarantinedScripts.slice(0, 8).map((script) => (
              <div className="result-row-static" key={script.script_id}>
                <span>rejected</span>
                <strong>{script.script_id}</strong>
                <small>{script.rejection_flags.join(', ')} · {script.catalog_storage_key}</small>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="safety-note">
        This dashboard is a read-only governance view. It cannot promote rows into Live Watch, enable scripts, or authorize memory writes.
      </p>

      <section className="registry-verification-box" aria-label="Read-only verification controls">
        <h4>Run Read-Only Verification</h4>
        <p className="muted">
          Explicit PID only. Solith opens a read/query-only process session in a background worker,
          checks AOB signatures, performs pointer-root module-bound preflight, and writes a JSON artifact.
        </p>
        <div className="registry-verification-form">
          <label>
            Selected PID
            <input
              inputMode="numeric"
              value={pidText}
              onChange={(event) => setPidText(event.target.value)}
              placeholder="12345"
            />
          </label>
          <label>
            Executable name
            <input
              value={executableName}
              onChange={(event) => setExecutableName(event.target.value)}
              placeholder="Game-Win64-Shipping.exe"
            />
          </label>
          <button
            id="registry-explorer-load-json"
            className="btn-primary"
            type="button"
            onClick={runVerification}
            disabled={running}
          >
            {running ? 'Verifying…' : 'Run Read-Only Verification'}
          </button>
        </div>

        {verificationError && (
          <p className="v2-session-ended-notice" role="alert">
            {verificationError}
          </p>
        )}

        {artifact && verificationSummary && (
          <div className="verification-result">
            <h4>Latest artifact</h4>
            <dl className="kv-grid">
              <dt>Saved path</dt>
              <dd>{artifactPath || 'not exported'}</dd>
              <dt>Process</dt>
              <dd>{artifact.process.executableName} · PID {artifact.process.pid}</dd>
              <dt>Unique AOBs</dt>
              <dd>{verificationSummary.unique_match}</dd>
              <dt>Multiple AOBs</dt>
              <dd>{verificationSummary.multiple_matches}</dd>
              <dt>No match</dt>
              <dd>{verificationSummary.no_match}</dd>
              <dt>L2 pointer chains resolved</dt>
              <dd>{artifact.summary.pointers.l2_resolved ?? 0}</dd>
              <dt>L2 unreadable/invalid</dt>
              <dd>{(artifact.summary.pointers.l2_unreadable ?? 0) + (artifact.summary.pointers.l2_invalid_chain ?? 0)}</dd>
              <dt>Helper unavailable</dt>
              <dd>{artifact.summary.pointers.helper_unavailable ?? 0}</dd>
              <dt>Pointer roots in module</dt>
              <dd>{artifact.summary.pointers.root_in_module_range ?? 0}</dd>
              <dt>Pointer roots out of range</dt>
              <dd>{artifact.summary.pointers.root_out_of_module_range ?? 0}</dd>
            </dl>
          </div>
        )}

        <div className="restart-compare-box">
          <h4>Restart comparison</h4>
          <p className="muted">Compares saved artifacts offline for AOB candidates and Pointer L3 verified telemetry.</p>
          <label>
            Load previous verification artifact
            <input type="file" accept="application/json,.json" onChange={onLoadPreviousArtifact} />
          </label>
          <button className="btn-secondary" type="button" onClick={compareRestart} disabled={!artifact || !previousArtifact}>
            Compare Previous vs Current
          </button>
          {restartComparison && (
            <>
              <dl className="kv-grid">
                <dt>Previous session</dt>
                <dd>{restartComparison.previousSessionId}</dd>
                <dt>Current session</dt>
                <dd>{restartComparison.currentSessionId}</dd>
                <dt>AOB L3 candidates</dt>
                <dd>{restartComparison.summary.restart_stable_unique}</dd>
                <dt>Hash changed</dt>
                <dd>{restartComparison.summary.hash_changed}</dd>
                <dt>Address changed</dt>
                <dd>{restartComparison.summary.address_or_offset_changed}</dd>
                <dt>Missing/not unique</dt>
                <dd>{restartComparison.summary.missing + restartComparison.summary.not_unique}</dd>
                <dt>Pointer L3 verified</dt>
                <dd>{pointerStability?.summary.l3_stability_verified ?? 0}</dd>
                <dt>Pointer warnings</dt>
                <dd>{pointerStability?.unstableWarnings.length ?? 0}</dd>
              </dl>
              {(pointerStability?.promotedToL3.length ?? 0) > 0 && (
                <div className="l3-telemetry" aria-label="L3 stability verified entries">
                  <span className="status-pill status-pill-green">L3 Stability Verified</span>
                  <small>{pointerStability?.promotedToL3.slice(0, 6).join(', ')}</small>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <L4GovernancePanel entries={l4Entries} />
    </section>
  );
}

const RegistryExplorerPage: React.FC<RegistryExplorerPageProps> = ({ registry: initialRegistry = null }) => {
  const [registry, setRegistry] = useState<CompiledCtRegistry | null>(initialRegistry);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | RegistryResultType>('all');
  const [excludeRejected, setExcludeRejected] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = useMemo(() => {
    if (!registry) return [];
    return searchRegistry(registry, {
      text: query || undefined,
      type: type === 'all' ? undefined : type,
      excludeRejected: excludeRejected || undefined,
    });
  }, [excludeRejected, query, registry, type]);

  const selected = results.find((result) => result.id === selectedId) ?? results[0] ?? null;
  const counts = registry?.artifact.counts;

  const onPickRegistryFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoadError('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ''));
        const loaded = validateLoadedRegistry(parsed);
        setRegistry(loaded);
        setSelectedId(null);
      } catch (error) {
        setRegistry(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    reader.onerror = () => setLoadError('Could not read the selected registry file.');
    reader.readAsText(file);
  };

  return (
    <main className="page registry-explorer-page">
      <header className="page-module-header">
        <div>
          <p className="eyebrow">Read-only research</p>
          <h1>CT Registry Explorer</h1>
          <p>Search compiled CT registry artifacts without executing scripts, attaching to a process, or writing memory.</p>
        </div>
        <PageWalkthrough pageId="registry-explorer" />
      </header>

      <section className="panel-card" aria-label="Load registry">
        <label>
          Load compiled registry JSON
          <input id="registry-explorer-load-json-file" type="file" accept="application/json,.json" onChange={onPickRegistryFile} />
        </label>
        <p className="safety-note">
          Local file only — schemas are validated in-renderer. Scripts remain inert (<code>executable=false</code>).
        </p>
        {loadError && (
          <p className="v2-session-ended-notice" role="alert">
            {loadError}
          </p>
        )}
      </section>

      {!registry ? (
        <section className="panel-card" role="status">
          <h3>No registry loaded</h3>
          <p>
            Compile with <code>npm run registry:compile -- path/to/table.CT out.json</code>, then load the JSON here.
          </p>
          <p className="safety-note">Phase 4 is display-only. It does not execute Auto Assembler scripts.</p>
        </section>
      ) : (
        <>
          <section className="panel-grid" aria-label="Registry overview">
            <div className="panel-card">
              <span>Source</span>
              <strong>{registry.artifact.source.filename}</strong>
            </div>
            <div className="panel-card">
              <span>Schema</span>
              <strong>{registry.artifact.schemaVersion}</strong>
            </div>
            <div className="panel-card">
              <span>Generated</span>
              <strong>{registry.artifact.generatedAt}</strong>
            </div>
            <div className="panel-card">
              <span>Pointers</span>
              <strong>{counts?.pointers ?? 0}</strong>
            </div>
            <div className="panel-card">
              <span>Scripts</span>
              <strong>{counts?.scripts ?? 0}</strong>
            </div>
            <div className="panel-card">
              <span>AOBs</span>
              <strong>{counts?.aobSignatures ?? 0}</strong>
            </div>
            <div className="panel-card">
              <span>Rejections</span>
              <strong>{counts?.rejections ?? 0}</strong>
            </div>
            <div className="panel-card">
              <span>Warnings</span>
              <strong>{counts?.warnings ?? 0}</strong>
            </div>
            <div className="panel-card">
              <span>Duplicates</span>
              <strong>{counts?.duplicates ?? 0}</strong>
            </div>
          </section>

          <GovernanceDashboard pipeline={registry.pipeline} registry={registry} />

          <section className="panel-card">
            <label>
              Search registry
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="health, Avowed-Win64, 48 8B..."
              />
            </label>
            <label>
              Type
              <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
                {TYPE_OPTIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={excludeRejected}
                onChange={(event) => setExcludeRejected(event.target.checked)}
              />{' '}
              Exclude rejections
            </label>
          </section>

          <div className="split-layout">
            <section className="panel-card" aria-label="Registry results">
              <h3>Matches ({results.length})</h3>
              {results.map((result) => (
                <button
                  className="result-row"
                  key={result.id}
                  type="button"
                  onClick={() => setSelectedId(result.id)}
                  aria-pressed={selected?.id === result.id}
                >
                  <span>{result.type}</span>
                  <strong>{result.title}</strong>
                  <small>{result.module ?? result.source.sourceEntryDescription}</small>
                </button>
              ))}
            </section>
            <DetailPanel result={selected} query={query} />
          </div>
        </>
      )}
    </main>
  );
};

export default RegistryExplorerPage;

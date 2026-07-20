import React, { useMemo, useState } from 'react';
import type { CompiledCtRegistry } from '../../core/registry/load-registry.js';
import type { RegistryResultType, RegistrySearchResult } from '../../core/registry/query-registry.js';
import { searchRegistry } from '../../core/registry/query-registry.js';

interface RegistryExplorerPageProps {
  registry?: CompiledCtRegistry | null;
}

const TYPE_OPTIONS: Array<'all' | RegistryResultType> = ['all', 'pointer', 'aob', 'script', 'rejection'];

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
        <dt>Line</dt>
        <dd>{result.source.lineNumber ?? '—'}</dd>
        <dt>Warnings</dt>
        <dd>{result.warnings.length ? result.warnings.join('; ') : 'none'}</dd>
      </dl>
      {result.pattern && (
        <>
          <h4>AOB pattern</h4>
          <code>{result.pattern}</code>
          <h4>Normalized</h4>
          <code>{result.normalizedPattern}</code>
        </>
      )}
      <p className="safety-note">Imported CE scripts and AOB metadata are displayed only; Solith does not execute Auto Assembler text here.</p>
      {scriptText && (
        <>
          <h4>Original inert script excerpt</h4>
          <pre className="script-preview">{excerpt(scriptText, query)}</pre>
        </>
      )}
    </section>
  );
}

const RegistryExplorerPage: React.FC<RegistryExplorerPageProps> = ({ registry = null }) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | RegistryResultType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = useMemo(() => {
    if (!registry) return [];
    return searchRegistry(registry, {
      text: query || undefined,
      type: type === 'all' ? undefined : type,
    });
  }, [query, registry, type]);

  const selected = results.find((result) => result.id === selectedId) ?? results[0] ?? null;
  const counts = registry?.artifact.counts;

  return (
    <main className="page registry-explorer-page">
      <header className="page-module-header">
        <p className="eyebrow">Read-only research</p>
        <h1>CT Registry Explorer</h1>
        <p>Search compiled CT registry artifacts without executing scripts, attaching to a process, or writing memory.</p>
      </header>

      {!registry ? (
        <section className="panel-card" role="status">
          <h3>No registry loaded</h3>
          <p>Compile a CT registry first, then connect this page to the upcoming file-picker/IPC loader.</p>
          <p className="safety-note">Phase 4 is display-only. It does not execute Auto Assembler scripts.</p>
        </section>
      ) : (
        <>
          <section className="panel-grid" aria-label="Registry overview">
            <div className="panel-card"><span>Source</span><strong>{registry.artifact.source.filename}</strong></div>
            <div className="panel-card"><span>Schema</span><strong>{registry.artifact.schemaVersion}</strong></div>
            <div className="panel-card"><span>Pointers</span><strong>{counts?.pointers ?? 0}</strong></div>
            <div className="panel-card"><span>Scripts</span><strong>{counts?.scripts ?? 0}</strong></div>
            <div className="panel-card"><span>AOBs</span><strong>{counts?.aobSignatures ?? 0}</strong></div>
            <div className="panel-card"><span>Warnings</span><strong>{counts?.warnings ?? 0}</strong></div>
          </section>

          <section className="panel-card">
            <label>
              Search registry
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="health, Avowed-Win64, 48 8B..." />
            </label>
            <label>
              Type
              <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
                {TYPE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
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

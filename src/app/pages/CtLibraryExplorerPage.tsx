import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import type { CtLibraryGameSummary, CtLibrarySummaryIndex } from '../../core/ct-library/types.js';
import type { CtLibrarySearchResult } from '../../core/ct-library/search.js';
import type { CtZipCatalogEntry } from '../../core/registry/compile-ct-zip.js';
import {
  ctImportUiReducer,
  friendlyCtImportError,
  idleCtImportUiState,
} from '../../core/ct-library/import-state.js';
import styles from './CtLibraryExplorerPage.module.css';

type KindFilter = 'all' | 'pointer' | 'script' | 'aob';

interface SearchResponse {
  success: boolean;
  available: boolean;
  summary?: CtLibrarySummaryIndex;
  total: number;
  results: CtLibrarySearchResult[];
  error?: string;
}

interface DetailResponse {
  success: boolean;
  available: boolean;
  game?: CtLibraryGameSummary;
  tables: CtZipCatalogEntry[];
  error?: string;
}

function formatNumber(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

function newImportJobId(): string {
  return `ct-library-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tableForResult(tables: CtZipCatalogEntry[], result: CtLibrarySearchResult | null): CtZipCatalogEntry | null {
  if (!result) return null;
  return tables.find((table) => table.sourceSha256 === result.sourceSha256 && table.archivePath === result.archivePath) ?? null;
}

type CtLibraryCheat = CtZipCatalogEntry['cheats'][number];

function cheatForResult(table: CtZipCatalogEntry | null, result: CtLibrarySearchResult | null): CtLibraryCheat | null {
  if (!table || !result) return null;
  return table.cheats.find((cheat) => result.id === `${result.gameId}:${table.sourceSha256}:${cheat.id}`) ?? null;
}

function DetailPanel({
  result,
  detail,
}: {
  result: CtLibrarySearchResult | null;
  detail: DetailResponse | null;
}) {
  const table = tableForResult(detail?.tables ?? [], result);
  const cheat = cheatForResult(table, result);
  const metadata = cheat?.metadata;

  if (!result) {
    return (
      <section className={styles.detail} aria-label="CT Library detail">
        <h2>Select an entry</h2>
        <p className={styles.meta}>Cheat Engine tables are displayed as metadata only. Scripts are never executed here.</p>
      </section>
    );
  }

  return (
    <section className={styles.detail} aria-label="CT Library detail">
      <div className={styles.pillRow}>
        <span className={styles.safetyPill}>metadata-only</span>
        <span className={styles.safetyPill}>executable=false</span>
        <span className={styles.safetyPill}>L0</span>
      </div>
      <h2>{result.title}</h2>
      <p className={styles.meta}>{result.type.toUpperCase()} · {result.gameDisplayName}</p>
      <dl className={styles.kv}>
        <dt>Game</dt>
        <dd>{result.gameDisplayName}</dd>
        <dt>Table</dt>
        <dd>{result.tableName}</dd>
        <dt>Archive path</dt>
        <dd>{result.archivePath}</dd>
        <dt>Source hash</dt>
        <dd>{result.sourceSha256.slice(0, 16)}…</dd>
        <dt>Pointer records</dt>
        <dd>{formatNumber(table?.counts.pointers)}</dd>
        <dt>Scripts</dt>
        <dd>{formatNumber(table?.counts.scripts)}</dd>
        <dt>AOB signatures</dt>
        <dd>{formatNumber(table?.counts.aobSignatures)}</dd>
        <dt>Rejections</dt>
        <dd>{formatNumber(table?.counts.rejections)}</dd>
        <dt>Warnings</dt>
        <dd>{formatNumber(table?.counts.warnings)}</dd>
      </dl>
      {table?.rejectedEntries && table.rejectedEntries.length > 0 && (
        <section className={styles.rejectionReport} aria-label="CT rejection report">
          <h3>Rejection report</h3>
          <p className={styles.meta}>Rejected entries remain metadata-only and are not promoted to executable controls.</p>
          <ul>
            {table.rejectedEntries.slice(0, 6).map((entry, index) => (
              <li key={`${entry.name}-${index}`}>
                <strong>{entry.name}</strong>
                <span>{entry.rejection_reason ?? entry.reason}</span>
              </li>
            ))}
          </ul>
          {table.rejectedEntries.length > 6 && (
            <p className={styles.meta}>Showing 6 of {formatNumber(table.rejectedEntries.length)} rejected entries.</p>
          )}
        </section>
      )}
      {metadata && (
        <section className={styles.metadataPanel} aria-label="Read-only CT metadata">
          <h3>Read-only metadata</h3>
          {result.type === 'aob' && (
            <dl className={styles.kv}>
              <dt>Symbol</dt>
              <dd>{metadata.symbol ?? result.title}</dd>
              <dt>Scan type</dt>
              <dd>{metadata.scanType ?? 'unknown'}</dd>
              <dt>Module</dt>
              <dd>{metadata.moduleName ?? 'module-less / process-wide'}</dd>
              <dt>Pattern</dt>
              <dd><code>{metadata.pattern ?? 'not available'}</code></dd>
              <dt>Source entry</dt>
              <dd>{metadata.sourceEntry ?? 'unknown'}</dd>
              <dt>Line</dt>
              <dd>{formatNumber(metadata.lineNumber)}</dd>
              <dt>Completeness</dt>
              <dd>{metadata.completeness ?? 'unknown'}</dd>
              <dt>Warnings</dt>
              <dd>{metadata.warnings?.length ? metadata.warnings.join('; ') : 'none'}</dd>
            </dl>
          )}
          {result.type === 'pointer' && (
            <dl className={styles.kv}>
              <dt>Data type</dt>
              <dd>{metadata.dataType ?? 'unknown'}</dd>
              <dt>Module</dt>
              <dd>{metadata.moduleName ?? 'unknown'}</dd>
              <dt>Raw address</dt>
              <dd><code>{metadata.rawAddress ?? 'not available'}</code></dd>
              <dt>Base offset</dt>
              <dd><code>{metadata.baseOffset ?? 'not restart-stable'}</code></dd>
              <dt>Pointer chain</dt>
              <dd>{metadata.pointerChain?.length ? metadata.pointerChain.map((offset) => `0x${offset.toString(16)}`).join(' → ') : 'none'}</dd>
              <dt>Resolution</dt>
              <dd>{metadata.liveResolution ?? 'metadata-only'}</dd>
            </dl>
          )}
          {result.type === 'script' && (
            <dl className={styles.kv}>
              <dt>Script type</dt>
              <dd>{metadata.scriptType ?? 'unknown'}</dd>
              <dt>Excerpt</dt>
              <dd><code>{metadata.scriptExcerpt ?? 'not available'}</code></dd>
            </dl>
          )}
        </section>
      )}
      <p className={styles.safety}>
        This explorer does not attach to a process, run Auto Assembler, download trainers, or write memory.
        Pointers and AOB signatures shown here are research metadata only and are not bound to LiveWatch execution paths.
      </p>
    </section>
  );
}

export default function CtLibraryExplorerPage() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [gameId, setGameId] = useState('all');
  const [summary, setSummary] = useState<CtLibrarySummaryIndex | null>(null);
  const [results, setResults] = useState<CtLibrarySearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [importState, dispatchImport] = useReducer(ctImportUiReducer, idleCtImportUiState);
  const importZipRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => results.find((result) => result.id === selectedId) ?? results[0] ?? null,
    [results, selectedId],
  );

  const load = useCallback(async () => {
    if (!window.electronAPI?.ctLibrarySearch) {
      setMessage('CT Library Explorer is unavailable outside the Electron shell.');
      return;
    }
    setLoading(true);
    try {
      const response = await window.electronAPI.ctLibrarySearch({
        query,
        kind,
        gameId: gameId === 'all' ? undefined : gameId,
        limit: 100,
        offset: 0,
      }) as SearchResponse;
      if (!response.success) {
        setMessage(response.error ?? 'CT Library search failed.');
        setResults([]);
        return;
      }
      setSummary(response.summary ?? null);
      setResults(response.results ?? []);
      setTotal(response.total ?? 0);
      setSelectedId(response.results?.[0]?.id ?? null);
      setMessage(response.available ? '' : 'No CT Library metadata has been imported yet.');
    } finally {
      setLoading(false);
    }
  }, [gameId, kind, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return window.electronAPI?.onCtLibraryImportProgress?.((progress) => {
      dispatchImport({ type: 'progress', progress });
    });
  }, []);

  useEffect(() => {
    if (!selected || !window.electronAPI?.ctLibraryGameDetail) {
      setDetail(null);
      return;
    }
    void (async () => {
      const response = await window.electronAPI.ctLibraryGameDetail({ gameId: selected.gameId }) as DetailResponse;
      setDetail(response);
    })();
  }, [selected]);

  const games = summary?.games ?? [];

  const handleImportZip = async (file: File) => {
    const filePath = (file as File & { path?: string }).path;
    const api = window.electronAPI;
    if (!api?.ctLibraryImportZipStart) {
      setMessage('CT ZIP import is unavailable outside the Electron shell.');
      return;
    }
    if (!filePath) {
      setMessage('CT ZIP import requires the Electron desktop app file path bridge.');
      return;
    }
    const jobId = newImportJobId();
    dispatchImport({ type: 'start', jobId, label: 'Hashing Source...' });
    setMessage('');
    try {
      const result = await api.ctLibraryImportZipStart({ archivePath: filePath, jobId });
      if (result.success) {
        dispatchImport({
          type: 'complete',
          progress: {
            jobId,
            phase: 'complete',
            label: 'Import Complete.',
            processedTables: result.totals?.compiledTables,
            totalTables: result.totals?.ctFiles,
          },
        });
        setMessage(
          `Imported CT library archive — ${formatNumber(result.totals?.compiledTables)} tables, ${formatNumber(result.totals?.cheats)} metadata entries.`,
        );
        await load();
      } else {
        dispatchImport({
          type: result.errorCode === 'ABORT_ERR' ? 'cancelled' : 'failed',
          errorCode: result.errorCode,
          errorMessage: result.error,
        });
        setMessage(friendlyCtImportError(result.errorCode, result.error));
      }
    } finally {
      if (importZipRef.current) importZipRef.current.value = '';
    }
  };

  const handleCancelImport = async () => {
    if (!importState.jobId) return;
    await window.electronAPI?.ctLibraryImportZipCancel?.({ jobId: importState.jobId });
  };

  return (
    <main className={styles.page}>
      <PageModuleHeader
        artwork="hoodedProfile"
        title="CT Library Explorer"
        description="Search and inspect compiled Cheat Engine table metadata without executing scripts or touching a live process."
        actions={
          <div className={styles.headerActions}>
            <input
              ref={importZipRef}
              type="file"
              accept=".zip,application/zip"
              className={styles.hiddenFileInput}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportZip(file);
              }}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => importZipRef.current?.click()}
              disabled={importState.status === 'running'}
            >
              Import CT ZIP
            </button>
          </div>
        }
      />

      {importState.status !== 'idle' && (
        <section
          className={`${styles.importPanel} ${importState.status === 'failed' ? styles.importPanelError : ''}`}
          aria-live="polite"
          aria-labelledby="ct-library-import-heading"
        >
          <div>
            <h2 id="ct-library-import-heading">CT Library Import</h2>
            <p>{importState.errorMessage ?? importState.progress?.label ?? 'Preparing metadata-only import...'}</p>
            {typeof importState.progress?.processedTables === 'number' && (
              <small>
                Tables processed: {importState.progress.processedTables}
                {typeof importState.progress.totalTables === 'number'
                  ? ` / ${importState.progress.totalTables}`
                  : ''}
              </small>
            )}
          </div>
          <div className={styles.importActions}>
            {importState.status === 'running' && (
              <button type="button" className={styles.cancelBtn} onClick={() => void handleCancelImport()}>
                Cancel Import
              </button>
            )}
            {(importState.status === 'failed' || importState.status === 'cancelled' || importState.status === 'complete') && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  dispatchImport({ type: 'reset' });
                  importZipRef.current?.click();
                }}
              >
                Retry / Import Another ZIP
              </button>
            )}
          </div>
        </section>
      )}

      <section className={styles.summaryGrid} aria-label="CT Library summary">
        <div className={styles.card}><span>CT files</span><strong>{formatNumber(summary?.totals.ctFiles)}</strong></div>
        <div className={styles.card}><span>Games</span><strong>{formatNumber(summary?.games.length)}</strong></div>
        <div className={styles.card}><span>Cheats</span><strong>{formatNumber(summary?.totals.cheats)}</strong></div>
        <div className={styles.card}><span>Pointers</span><strong>{formatNumber(summary?.totals.pointers)}</strong></div>
        <div className={styles.card}><span>Scripts</span><strong>{formatNumber(summary?.totals.scripts)}</strong></div>
        <div className={styles.card}><span>AOBs</span><strong>{formatNumber(summary?.totals.aobSignatures)}</strong></div>
      </section>

      <section className={styles.toolbar} aria-label="CT Library filters">
        <label>
          Search table, game, cheat, AOB, or script name
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="health, gold, aob, Avowed..."
          />
        </label>
        <label>
          Game
          <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
            <option value="all">All games</option>
            {games.slice(0, 1000).map((game) => (
              <option key={game.gameId} value={game.gameId}>
                {game.displayName} ({formatNumber(game.cheatCount)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Entry type
          <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}>
            <option value="all">All metadata</option>
            <option value="pointer">Pointers</option>
            <option value="script">Scripts</option>
            <option value="aob">AOB signatures</option>
          </select>
        </label>
      </section>

      {message && <p className={styles.empty}>{message}</p>}

      <div className={styles.layout}>
        <section className={styles.results} aria-label="CT Library results">
          <h2>{loading ? 'Searching…' : `Matches ${formatNumber(results.length)} / ${formatNumber(total)}`}</h2>
          <div className={styles.resultList}>
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                className={styles.resultRow}
                aria-pressed={selected?.id === result.id}
                onClick={() => setSelectedId(result.id)}
              >
                <span className={styles.pillRow}>
                  <span className={styles.pill}>{result.type}</span>
                  <span className={styles.safetyPill}>metadata-only</span>
                </span>
                <strong>{result.title}</strong>
                <span className={styles.meta}>{result.gameDisplayName} · {result.tableName}</span>
              </button>
            ))}
            {!loading && results.length === 0 && (
              <p className={styles.empty}>No metadata entries matched these filters.</p>
            )}
          </div>
        </section>
        <DetailPanel result={selected} detail={detail} />
      </div>
    </main>
  );
}

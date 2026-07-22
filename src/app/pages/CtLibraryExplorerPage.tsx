import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import type { CtLibraryGameSummary, CtLibrarySummaryIndex } from '../../core/ct-library/types.js';
import type { CtLibrarySearchResult } from '../../core/ct-library/search.js';
import type { CtZipCatalogEntry } from '../../core/registry/compile-ct-zip.js';
import { RESEARCH_PROMOTE_SEED_KEY, type ResearchPromoteSeed } from '../../core/live-memory/ct-promote.js';
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

function tableForResult(tables: CtZipCatalogEntry[], result: CtLibrarySearchResult | null): CtZipCatalogEntry | null {
  if (!result) return null;
  return tables.find((table) => table.sourceSha256 === result.sourceSha256 && table.archivePath === result.archivePath) ?? null;
}

function DetailPanel({
  result,
  detail,
  onPromote,
}: {
  result: CtLibrarySearchResult | null;
  detail: DetailResponse | null;
  onPromote: (result: CtLibrarySearchResult) => void;
}) {
  const table = tableForResult(detail?.tables ?? [], result);

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
                <span>{entry.reason}</span>
              </li>
            ))}
          </ul>
          {table.rejectedEntries.length > 6 && (
            <p className={styles.meta}>Showing 6 of {formatNumber(table.rejectedEntries.length)} rejected entries.</p>
          )}
        </section>
      )}
      {result.type === 'pointer' && (
        <p>
          <button type="button" className="btn-primary" onClick={() => onPromote(result)}>
            Promote to Live Watch seed
          </button>
        </p>
      )}
      <p className={styles.safety}>
        This explorer does not attach to a process, run Auto Assembler, download trainers, or write memory.
        Promote seeds Research Lab / Live Toggle Cards after you attach with the single-player waiver.
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

  const handlePromote = useCallback((result: CtLibrarySearchResult) => {
    const seed: ResearchPromoteSeed = {
      label: result.title,
      liveResolution: 'incomplete',
      addressHint: undefined,
    };
    // Metadata-only promote: seed label for Research Lab; full path comes from CT import.
    localStorage.setItem(RESEARCH_PROMOTE_SEED_KEY, JSON.stringify(seed));
    setMessage(`Promoted “${result.title}” seed — open Advanced Scan Mode / Research panel after attach.`);
  }, []);

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

  return (
    <main className={styles.page}>
      <PageModuleHeader
        artwork="hoodedProfile"
        title="CT Library Explorer"
        description="Search and inspect compiled Cheat Engine table metadata without executing scripts or touching a live process."
      />

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
        <DetailPanel result={selected} detail={detail} onPromote={handlePromote} />
      </div>
    </main>
  );
}

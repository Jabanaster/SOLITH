import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './TrainerLibraryPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { VirtualCatalogGrid } from '../components/VirtualCatalogGrid.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import { getCatalogTagline } from '../../core/trainer-catalog/game-taglines.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';

interface SearchResponse {
  success: boolean;
  entries?: TrainerCatalogEntry[];
  total?: number;
  error?: string;
}

interface TrustMeta {
  positive: number;
  negative: number;
  quarantined: boolean;
}

const PAGE_SIZE = 120;

function tierHint(entry: TrainerCatalogEntry): string {
  if (entry.verificationStatus === 'verified') return 'Instant — verified definition';
  if (entry.verificationStatus === 'community') return 'First session scan may be required';
  return 'Metadata only — sync or import a definition';
}

function CatalogCard({
  entry,
  trust,
  onLaunch,
  onExport,
  onThumbUp,
}: {
  entry: TrainerCatalogEntry;
  trust?: TrustMeta;
  onLaunch: (entry: TrainerCatalogEntry) => void;
  onExport: (entry: TrainerCatalogEntry) => void;
  onThumbUp: (entry: TrainerCatalogEntry) => void;
}) {
  const tagline = getCatalogTagline(entry);
  return (
    <article className={styles.card}>
      <div className={styles.coverWrap}>
        {entry.coverUrl && entry.steamAppId && entry.steamAppId < 1_000_000 ? (
          <img
            src={entry.coverUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className={styles.coverFallback}>{entry.displayName.charAt(0)}</div>
        )}
        <span className={styles.badge} title={tierHint(entry)}>
          {entry.verificationStatus}
        </span>
      </div>
      <div className={styles.cardBody}>
        <h2>{entry.displayName}</h2>
        <p className={styles.tagline}>{tagline}</p>
        <p>{entry.categories.slice(0, 2).join(' · ')}</p>
        <p className={styles.meta}>
          {entry.hasModPack ? `${entry.cheatCount || '—'} cheats` : 'Metadata only'}
          {trust?.positive ? ` · ${trust.positive} confirmed` : ''}
          {trust?.quarantined ? ' · needs re-verify' : ''}
        </p>
        <p className={styles.meta}>{tierHint(entry)}</p>
        <div className={styles.cardActions}>
          <button type="button" className={styles.launchBtn} onClick={() => void onLaunch(entry)}>
            {entry.hasModPack ? 'Load Trainer' : 'View'}
          </button>
          {entry.hasModPack && (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => void onExport(entry)}>
                Export YAML
              </button>
              {entry.verificationStatus === 'community' && (
                <button type="button" className={styles.secondaryBtn} onClick={() => void onThumbUp(entry)}>
                  Confirm works
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export default function TrainerLibraryPage({
  onLaunchGame,
}: {
  onLaunchGame?: (
    catalogGameId: string,
    displayName: string,
    capabilities?: { memoryCheatCount?: number; saveControlCount?: number },
  ) => void;
}) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<TrainerCatalogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'community' | 'metadata-only'>('all');
  const [importing, setImporting] = useState(false);
  const [trustMeta, setTrustMeta] = useState<Record<string, TrustMeta>>({});
  const [quarantineCount, setQuarantineCount] = useState(0);
  const importYamlRef = useRef<HTMLInputElement>(null);
  const importCtRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const fetchPage = useCallback(async (searchQuery: string, pageOffset: number, append: boolean) => {
    if (!window.electronAPI?.trainerCatalogSearch) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      if (pageOffset === 0) await window.electronAPI.trainerCatalogSeed?.();
      const result = (await window.electronAPI.trainerCatalogSearch({
        query: searchQuery,
        limit: PAGE_SIZE,
        offset: pageOffset,
      })) as SearchResponse;
      if (result.success && result.entries) {
        setEntries((prev) => (append ? [...prev, ...result.entries!] : result.entries!));
        setTotal(result.total ?? result.entries.length);
        setOffset(pageOffset + result.entries.length);
      } else {
        setMessage(result.error ?? 'Search failed');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const load = useCallback(async (searchQuery = query) => {
    setOffset(0);
    await fetchPage(searchQuery, 0, false);
  }, [fetchPage, query]);

  useEffect(() => {
    void load('');
  }, [load]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCatalogProcessDetected?.((payload) => {
      setMessage(`Detected ${payload.displayName} (${payload.executable}) — open Trainer Library to load.`);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogFeedbackSummary) return;
    const withPacks = entries.filter((e) => e.hasModPack);
    if (withPacks.length === 0) {
      setTrustMeta({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, TrustMeta> = {};
      await Promise.all(
        withPacks.slice(0, 40).map(async (entry) => {
          const result = await api.trainerCatalogFeedbackSummary!({ catalogGameId: entry.catalogGameId });
          if (result.success && result.summary) {
            next[entry.catalogGameId] = {
              positive: result.summary.positive,
              negative: result.summary.negative,
              quarantined: Boolean(result.quarantined),
            };
          }
        }),
      );
      if (!cancelled) setTrustMeta(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogPendingQuarantine) return;
    void api.trainerCatalogPendingQuarantine().then((result) => {
      if (result.success && result.pending) setQuarantineCount(result.pending.length);
    });
  }, [entries, message]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void load(query);
  };

  const handleLoadMore = useCallback(() => {
    if (loadingMore || loading || entries.length >= total) return;
    void fetchPage(queryRef.current, offset, true);
  }, [loadingMore, loading, entries.length, total, offset, fetchPage]);

  const handleSync = async () => {
    if (!window.electronAPI?.trainerCatalogSyncRemote) return;
    setSyncing(true);
    setMessage('');
    try {
      const result = await window.electronAPI.trainerCatalogSyncRemote();
      if (result.success && result.report) {
        const imported = result.report.totalImported ?? 0;
        setMessage(`Synced ${imported} trainer definitions from community listings`);
        await load(query);
      } else {
        setMessage(result.error ?? 'Sync failed');
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleImportYaml = async (file: File) => {
    if (!window.electronAPI?.trainerCatalogImportYaml) return;
    setImporting(true);
    setMessage('');
    try {
      const yamlText = await file.text();
      const result = await window.electronAPI.trainerCatalogImportYaml({ yamlText });
      if (result.success) {
        setMessage(`Imported "${result.title ?? file.name}" (${result.cheatCount ?? 0} cheats) into the catalog.`);
        await load(query);
      } else {
        const detail = result.errors?.join('; ') ?? result.error ?? 'Import failed';
        setMessage(detail);
      }
    } finally {
      setImporting(false);
      if (importYamlRef.current) importYamlRef.current.value = '';
    }
  };

  const handleImportCt = async (file: File) => {
    if (!window.electronAPI?.trainerCatalogImportCt) return;
    setImporting(true);
    setMessage('');
    try {
      const xmlText = await file.text();
      const result = await window.electronAPI.trainerCatalogImportCt({ xmlText, title: file.name.replace(/\.ct$/i, '') });
      if (result.success) {
        setMessage(
          `Imported "${result.title ?? file.name}" — ${result.acceptedCount ?? 0} accepted, ${result.rejectedCount ?? 0} rejected.`,
        );
        await load(query);
      } else {
        const detail = result.errors?.join('; ') ?? result.error ?? 'Import failed';
        setMessage(detail);
      }
    } finally {
      setImporting(false);
      if (importCtRef.current) importCtRef.current.value = '';
    }
  };

  const handleLaunch = async (entry: TrainerCatalogEntry) => {
    const loadResult = await window.electronAPI?.trainerCatalogLoadGame?.({
      catalogGameId: entry.catalogGameId,
    });
    if (!loadResult?.success) {
      setMessage(loadResult?.error === 'no_mod_pack'
        ? `${entry.displayName} is in the catalog but has no mod pack yet — use Advanced Scan Mode or sync remote sources.`
        : loadResult?.error ?? 'Failed to load game');
      return;
    }
    onLaunchGame?.(entry.catalogGameId, entry.displayName, loadResult.capabilities);
  };

  const handleExportYaml = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogExportDefinition) return;
    const result = await api.trainerCatalogExportDefinition({ catalogGameId: entry.catalogGameId });
    if (result.success && result.yaml && result.filename) {
      downloadTextFile(result.filename, result.yaml);
      setMessage(`Exported community pack for ${entry.displayName}.`);
    } else {
      setMessage(result.error ?? 'Export failed — no definition payload found.');
    }
  };

  const handleThumbUp = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogFeedbackRecord) return;
    const result = await api.trainerCatalogFeedbackRecord({
      catalogGameId: entry.catalogGameId,
      featureId: '_pack',
      rating: 1,
    });
    if (result.success && result.summary) {
      setTrustMeta((prev) => ({
        ...prev,
        [entry.catalogGameId]: {
          positive: result.summary!.positive,
          negative: result.summary!.negative,
          quarantined: prev[entry.catalogGameId]?.quarantined ?? false,
        },
      }));
      setMessage(`Thanks — community confirmation recorded for ${entry.displayName}.`);
    }
  };

  const visible = entries.filter((e) => filter === 'all' || e.verificationStatus === filter);

  return (
    <div className={styles.page}>
      <PageModuleHeader
        artwork="trainerController"
        className={styles.header}
        title="Trainer Library"
        description={`${total.toLocaleString()} games · virtualized grid · Steam artwork on verified App IDs`}
        actions={
          <div className={styles.actions}>
            <input
              ref={importYamlRef}
              type="file"
              accept=".yml,.yaml,text/yaml"
              className={styles.hiddenFileInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportYaml(file);
              }}
            />
            <input
              ref={importCtRef}
              type="file"
              accept=".ct,.xml,text/xml"
              className={styles.hiddenFileInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportCt(file);
              }}
            />
            <button type="button" className={styles.syncBtn} onClick={() => importCtRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import CT'}
            </button>
            <button type="button" className={styles.syncBtn} onClick={() => importYamlRef.current?.click()} disabled={importing}>
              Import YAML
            </button>
            <button type="button" className={styles.syncBtn} onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync community listings'}
            </button>
          </div>
        }
      />

      <form className={styles.searchRow} onSubmit={handleSearch}>
        <input
          type="search"
          placeholder="Search thousands of games…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search trainer library"
        />
        <button type="submit">Search</button>
      </form>

      <div className={styles.filters}>
        {(['all', 'verified', 'community', 'metadata-only'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? styles.filterActive : styles.filterBtn}
            onClick={() => setFilter(f)}
          >
            {f === 'metadata-only' ? 'Metadata' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {quarantineCount > 0 && (
        <p className={styles.quarantineBanner} role="status">
          {quarantineCount} definition{quarantineCount === 1 ? '' : 's'} queued for re-verification after executable drift.
        </p>
      )}
      {loading && <p className={styles.loading}>Loading catalog…</p>}

      {!loading && visible.length > 0 && (
        <VirtualCatalogGrid
          className={styles.virtualScroll}
          gridClassName={styles.grid}
          items={visible}
          getKey={(entry) => entry.catalogGameId}
          onEndReached={handleLoadMore}
          renderItem={(entry) => (
            <CatalogCard
              entry={entry}
              trust={trustMeta[entry.catalogGameId]}
              onLaunch={handleLaunch}
              onExport={handleExportYaml}
              onThumbUp={handleThumbUp}
            />
          )}
        />
      )}

      {loadingMore && <p className={styles.loading}>Loading more… ({entries.length} / {total})</p>}
    </div>
  );
}

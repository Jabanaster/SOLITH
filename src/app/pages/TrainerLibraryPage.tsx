import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './TrainerLibraryPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';

interface SearchResponse {
  success: boolean;
  entries?: TrainerCatalogEntry[];
  total?: number;
  error?: string;
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'community' | 'metadata-only'>('all');
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (searchQuery = query) => {
    if (!window.electronAPI?.trainerCatalogSearch) return;
    setLoading(true);
    try {
      await window.electronAPI.trainerCatalogSeed?.();
      const result = (await window.electronAPI.trainerCatalogSearch({
        query: searchQuery,
        limit: 96,
        offset: 0,
      })) as SearchResponse;
      if (result.success && result.entries) {
        setEntries(result.entries);
        setTotal(result.total ?? result.entries.length);
      } else {
        setMessage(result.error ?? 'Search failed');
      }
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load('');
  }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void load(query);
  };

  const handleSync = async () => {
    if (!window.electronAPI?.trainerCatalogSyncRemote) return;
    setSyncing(true);
    setMessage('');
    try {
      const result = await window.electronAPI.trainerCatalogSyncRemote();
      if (result.success && result.report) {
        const imported = result.report.totalImported ?? 0;
        setMessage(`Synced ${imported} trainer definitions from MrAntiFun / FLiNG / Plitch`);
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
        setMessage(
          `Imported "${result.title ?? file.name}" (${result.cheatCount ?? 0} cheats) into the catalog.`,
        );
        await load(query);
      } else {
        const detail = result.errors?.join('; ') ?? result.error ?? 'Import failed';
        setMessage(detail);
      }
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleLaunch = async (entry: TrainerCatalogEntry) => {
    const loadResult = await window.electronAPI?.trainerCatalogLoadGame?.({
      catalogGameId: entry.catalogGameId,
    });
    if (!loadResult?.success) {
      setMessage(loadResult?.error === 'no_mod_pack'
        ? `${entry.displayName} is in the catalog but has no mod pack yet — use Cheat Engine mode or sync remote sources.`
        : loadResult?.error ?? 'Failed to load game');
      return;
    }
    onLaunchGame?.(entry.catalogGameId, entry.displayName, loadResult.capabilities);
  };

  const visible = entries.filter((e) => filter === 'all' || e.verificationStatus === filter);

  return (
    <div className={styles.page}>
      <PageModuleHeader
        artwork="trainerController"
        className={styles.header}
        title="Trainer Library"
        description={`${total.toLocaleString()} games · searchable catalog with Steam artwork`}
        actions={
          <div className={styles.actions}>
            <input
              ref={importInputRef}
              type="file"
              accept=".yml,.yaml,text/yaml"
              className={styles.hiddenFileInput}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportYaml(file);
              }}
            />
            <button
              type="button"
              className={styles.syncBtn}
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Import YAML'}
            </button>
            <button type="button" className={styles.syncBtn} onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync MrAntiFun / FLiNG / Plitch'}
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
      {loading && <p className={styles.loading}>Loading catalog…</p>}

      <div className={styles.grid}>
        {visible.map((entry) => (
          <article key={entry.catalogGameId} className={styles.card}>
            <div className={styles.coverWrap}>
              {entry.coverUrl ? (
                <img src={entry.coverUrl} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className={styles.coverFallback}>{entry.displayName.charAt(0)}</div>
              )}
              <span
                className={styles.badge}
                title={
                  entry.verificationStatus === 'verified'
                    ? 'Bundled definition with verified save or memory controls'
                    : entry.verificationStatus === 'metadata-only'
                      ? 'Catalog metadata only — no bundled trainer definition yet'
                      : entry.verificationStatus === 'community'
                        ? 'Imported listing — pointer paths require discovery'
                        : 'Unverified trainer listing'
                }
              >
                {entry.verificationStatus}
              </span>
            </div>
            <div className={styles.cardBody}>
              <h2>{entry.displayName}</h2>
              <p>{entry.categories.slice(0, 2).join(' · ')}</p>
              <p className={styles.meta}>
                {entry.hasModPack ? `${entry.cheatCount || '—'} cheats` : 'Metadata only'}
              </p>
              <button type="button" className={styles.launchBtn} onClick={() => void handleLaunch(entry)}>
                {entry.hasModPack ? 'Load Trainer' : 'View'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import styles from './TrainerLibraryPage.module.css';
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
  onLaunchGame?: (catalogGameId: string, displayName: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<TrainerCatalogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'all' | 'verified' | 'community' | 'metadata-only'>('all');

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
    onLaunchGame?.(entry.catalogGameId, entry.displayName);
  };

  const visible = entries.filter((e) => filter === 'all' || e.verificationStatus === filter);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Trainer Library</h1>
          <p>{total.toLocaleString()} games · searchable catalog with Steam artwork</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.syncBtn} onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync MrAntiFun / FLiNG / Plitch'}
          </button>
        </div>
      </header>

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
              <span className={styles.badge}>{entry.verificationStatus}</span>
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

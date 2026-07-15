import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './TrainerLibraryPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { VirtualCatalogGrid } from '../components/VirtualCatalogGrid.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import { getCatalogTagline } from '../../core/trainer-catalog/game-taglines.js';
import { CATALOG_GENRE_FILTERS } from '../../core/trainer-catalog/catalog-genres.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import { resolveCatalogCoverUrl } from '../../core/trainer-catalog/cover-url.js';

type TierFilter = 'all' | 'verified' | 'community' | 'metadata-only';
type SortMode = 'installed-first' | 'a-z';

function dirnameFromPath(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return i >= 0 ? filePath.slice(0, i) : filePath;
}

function basenameNoExe(filePath: string): string {
  const base = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
  return base.replace(/\.exe$/i, '');
}

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
  installed,
  running,
  healthStatus,
  onLaunch,
  onExport,
  onThumbUp,
  onRequestVerification,
  onNotify,
}: {
  entry: TrainerCatalogEntry;
  trust?: TrustMeta;
  installed?: boolean;
  running?: boolean;
  healthStatus?: string;
  onLaunch: (entry: TrainerCatalogEntry) => void;
  onExport: (entry: TrainerCatalogEntry) => void;
  onThumbUp: (entry: TrainerCatalogEntry) => void;
  onRequestVerification: (entry: TrainerCatalogEntry) => void;
  onNotify: (entry: TrainerCatalogEntry) => void;
}) {
  const tagline = getCatalogTagline(entry);
  const coverUrl = resolveCatalogCoverUrl(entry);
  return (
    <article className={styles.card}>
      <div className={styles.coverWrap}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`${entry.displayName} cover art`}
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const fallback = img.nextElementSibling;
              if (fallback) (fallback as HTMLElement).style.display = 'flex';
            }}
          />
        ) : null}
        <div className={styles.coverFallback} style={coverUrl ? { display: 'none' } : undefined}>
          {entry.displayName.charAt(0)}
        </div>
        <span className={styles.badge} title={tierHint(entry)}>
          {entry.verificationStatus}
        </span>
        {installed && (
          <span className={styles.installedBadge} title="Detected on this PC">
            Installed
          </span>
        )}
        {running && (
          <span className={styles.runningBadge} title="Process detected on this PC">
            Running
          </span>
        )}
        {(healthStatus === 'stale' || healthStatus === 'quarantined') && (
          <span className={styles.staleBadge} title="Executable drift or quarantine">
            Stale
          </span>
        )}
      </div>
      <div className={styles.cardBody}>
        <h2>{entry.displayName}</h2>
        <p className={styles.tagline}>{tagline}</p>
        <p>{entry.categories.slice(0, 2).join(' · ')}</p>
        <p className={styles.meta}>
          {entry.hasModPack ? `${entry.cheatCount || '—'} cheats` : 'Metadata only'}
          {trust?.positive ? ` · ${trust.positive} confirmation${trust.positive === 1 ? '' : 's'}` : ''}
          {trust?.quarantined ? ' · needs re-verify' : ''}
        </p>
        <p className={styles.meta}>{tierHint(entry)}</p>
        <div className={styles.cardActions}>
          <button type="button" className={styles.launchBtn} onClick={() => void onLaunch(entry)}>
            {entry.hasModPack ? 'Open Trainer Deck' : 'View'}
          </button>
          {entry.hasModPack && (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={() => void onExport(entry)}>
                Export YAML
              </button>
              {entry.verificationStatus === 'community' && (
                <>
                  <button type="button" className={styles.secondaryBtn} onClick={() => void onThumbUp(entry)}>
                    Confirm works
                  </button>
                  <button type="button" className={styles.secondaryBtn} onClick={() => void onRequestVerification(entry)}>
                    Request verification
                  </button>
                </>
              )}
              {entry.verificationStatus === 'metadata-only' && (
                <button type="button" className={styles.secondaryBtn} onClick={() => void onNotify(entry)}>
                  Notify when verified
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
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [genreFilters, setGenreFilters] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [trustMeta, setTrustMeta] = useState<Record<string, TrustMeta>>({});
  const [quarantineCount, setQuarantineCount] = useState(0);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [healthMap, setHealthMap] = useState<Record<string, { status: string }>>({});
  const [installedOnly, setInstalledOnly] = useState(false);
  const [runningOnly, setRunningOnly] = useState(false);
  const [needsReverifyOnly, setNeedsReverifyOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('installed-first');
  const [dragOver, setDragOver] = useState(false);
  const [scanningInstalls, setScanningInstalls] = useState(false);
  const importYamlRef = useRef<HTMLInputElement>(null);
  const importCtRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  const tierFilterRef = useRef(tierFilter);
  const genreFiltersRef = useRef(genreFilters);
  queryRef.current = query;
  tierFilterRef.current = tierFilter;
  genreFiltersRef.current = genreFilters;

  const fetchPage = useCallback(async (
    searchQuery: string,
    pageOffset: number,
    append: boolean,
    tier: TierFilter,
    genres: string[],
  ) => {
    if (!window.electronAPI?.trainerCatalogSearch) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      if (pageOffset === 0) await window.electronAPI.trainerCatalogSeed?.();
      const result = (await window.electronAPI.trainerCatalogSearch({
        query: searchQuery,
        limit: PAGE_SIZE,
        offset: pageOffset,
        verificationStatus: tier,
        categories: genres.length > 0 ? genres : undefined,
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

  const load = useCallback(async (
    searchQuery = query,
    tier: TierFilter = tierFilter,
    genres: string[] = genreFilters,
  ) => {
    setOffset(0);
    await fetchPage(searchQuery, 0, false, tier, genres);
  }, [fetchPage, query, tierFilter, genreFilters]);

  useEffect(() => {
    void load(query, tierFilter, genreFilters);
  }, [tierFilter, genreFilters]); // eslint-disable-line react-hooks/exhaustive-deps -- text search uses submit

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.installDiscoveryList) return;
    void api.installDiscoveryList().then((result) => {
      if (result.success && result.catalogGameIds) {
        setInstalledIds(new Set(result.catalogGameIds));
      }
    });
    void api.trainerHealthList?.().then((result) => {
      if (result.success && result.map) setHealthMap(result.map);
    });
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCatalogProcessDetected?.((payload) => {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.add(payload.catalogGameId);
        return next;
      });
    });
    return () => unsubscribe?.();
  }, []);

  const refreshInstalledList = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.installDiscoveryList) return;
    const list = await api.installDiscoveryList();
    if (list.success && list.catalogGameIds) {
      setInstalledIds(new Set(list.catalogGameIds));
    }
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
    void fetchPage(
      queryRef.current,
      offset,
      true,
      tierFilterRef.current,
      genreFiltersRef.current,
    );
  }, [loadingMore, loading, entries.length, total, offset, fetchPage]);

  const toggleGenre = (genre: string) => {
    setGenreFilters((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );
  };

  const clearGenres = () => setGenreFilters([]);

  const handleScanInstalled = async () => {
    const api = window.electronAPI;
    if (!api?.installDiscoveryScan) return;
    setScanningInstalls(true);
    setMessage('');
    try {
      await api.trainerCatalogSeed?.();
      const result = await api.installDiscoveryScan();
      if (result.success) {
        const list = await api.installDiscoveryList();
        if (list.success && list.catalogGameIds) {
          setInstalledIds(new Set(list.catalogGameIds));
        }
        const health = await api.trainerHealthCheck?.();
        if (health?.success && health.map) setHealthMap(health.map);
        setMessage(
          `Scan complete — ${result.discovered ?? 0} installs found, ${result.matched ?? 0} matched to catalog.`,
        );
      } else {
        setMessage(result.error ?? 'Install scan failed');
      }
    } finally {
      setScanningInstalls(false);
    }
  };

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

  const handleNotifyWhenVerified = async (entry: TrainerCatalogEntry) => {
    const result = await window.electronAPI?.catalogDemandNotify?.({
      catalogGameId: entry.catalogGameId,
      kind: 'notify',
    });
    if (result?.success) {
      setMessage(`Notify recorded for ${entry.displayName} (${result.demand?.notifyCount ?? 1} local).`);
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

  const entryNeedsReverify = useCallback(
    (catalogGameId: string) => {
      const health = healthMap[catalogGameId]?.status;
      if (health === 'stale' || health === 'quarantined') return true;
      if (trustMeta[catalogGameId]?.quarantined) return true;
      return false;
    },
    [healthMap, trustMeta],
  );

  const handleDropExe = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.exe$/i.test(file.name)) {
      setMessage('Only .exe files can be dropped to add a game.');
      return;
    }
    const filePath = (file as File & { path?: string }).path;
    if (!filePath) {
      setMessage('Drop-to-add requires the Electron desktop app (file path unavailable in browser).');
      return;
    }
    const api = window.electronAPI;
    if (!api?.addGame) {
      setMessage('addGame is not available in this environment.');
      return;
    }
    const installDir = dirnameFromPath(filePath);
    const gameName = basenameNoExe(filePath) || file.name.replace(/\.exe$/i, '');
    setMessage('');
    try {
      const result = await api.addGame({ name: gameName, path: installDir });
      if (result?.success) {
        if (api.installDiscoveryScan) {
          await api.installDiscoveryScan();
        }
        await refreshInstalledList();
        setMessage(`Added "${gameName}" from ${installDir}.`);
      } else {
        setMessage(result?.error ?? 'Failed to add game from dropped executable.');
      }
    } catch {
      setMessage('Failed to add game from dropped executable.');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const handleRequestVerification = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogEvaluatePromotion) return;
    const result = await api.trainerCatalogEvaluatePromotion({ catalogGameId: entry.catalogGameId });
    if (!result.success) {
      setMessage(result.error ?? 'Could not evaluate promotion eligibility.');
      return;
    }
    const { eligible, reasons } = result.eligibility ?? { eligible: false, reasons: [] as string[] };
    const trust = trustMeta[entry.catalogGameId];
    if (eligible) {
      setMessage(`${entry.displayName} meets offline promotion rules — L3 live certification still required before verified tier.`);
      return;
    }
    const positive = trust?.positive ?? 0;
    setMessage(
      `${entry.displayName}: ${positive} confirmation${positive === 1 ? '' : 's'} · not yet eligible (${reasons.join(', ') || 'needs more evidence'})`,
    );
  };

  const visible = entries
    .filter((e) => {
      if (installedOnly && !installedIds.has(e.catalogGameId)) return false;
      if (runningOnly && !runningIds.has(e.catalogGameId)) return false;
      if (needsReverifyOnly && !entryNeedsReverify(e.catalogGameId)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (sortMode === 'a-z') {
        return a.displayName.localeCompare(b.displayName);
      }
      const aInstalled = installedIds.has(a.catalogGameId) ? 1 : 0;
      const bInstalled = installedIds.has(b.catalogGameId) ? 1 : 0;
      if (aInstalled !== bInstalled) return bInstalled - aInstalled;
      return a.displayName.localeCompare(b.displayName);
    });

  const activeFilterSummary =
    [
      genreFilters.length > 0 ? genreFilters.join(', ') : null,
      tierFilter !== 'all' ? tierFilter : null,
      installedOnly ? 'installed' : null,
      runningOnly ? 'running' : null,
      needsReverifyOnly ? 'needs re-verify' : null,
      sortMode === 'a-z' ? 'A–Z' : null,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  const resetLibraryFilters = () => {
    setInstalledOnly(false);
    setRunningOnly(false);
    setNeedsReverifyOnly(false);
  };

  return (
    <div
      className={`${styles.page}${dragOver ? ` ${styles.pageDragOver}` : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDropExe(e)}
    >
      <PageModuleHeader
        artwork="trainerController"
        className={styles.header}
        title="Trainer Library"
        description={`${total.toLocaleString()} games${activeFilterSummary ? ` · ${activeFilterSummary}` : ''} · virtualized grid`}
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
            <button type="button" className={styles.syncBtn} onClick={() => void handleScanInstalled()} disabled={scanningInstalls}>
              {scanningInstalls ? 'Scanning…' : 'Scan installed games'}
            </button>
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

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Verification</span>
        <div className={styles.filters}>
          {(['all', 'verified', 'community', 'metadata-only'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={tierFilter === f ? styles.filterActive : styles.filterBtn}
              onClick={() => {
                setTierFilter(f);
                resetLibraryFilters();
              }}
            >
              {f === 'metadata-only' ? 'Metadata' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button
            type="button"
            className={installedOnly ? styles.filterActive : styles.filterBtn}
            onClick={() => setInstalledOnly((v) => !v)}
            aria-pressed={installedOnly}
          >
            Installed
          </button>
          <button
            type="button"
            className={runningOnly ? styles.filterActive : styles.filterBtn}
            onClick={() => setRunningOnly((v) => !v)}
            aria-pressed={runningOnly}
          >
            Running
          </button>
          <button
            type="button"
            className={needsReverifyOnly ? styles.filterActive : styles.filterBtn}
            onClick={() => setNeedsReverifyOnly((v) => !v)}
            aria-pressed={needsReverifyOnly}
          >
            Needs re-verify
          </button>
        </div>
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Sort</span>
        <div className={styles.filters}>
          <button
            type="button"
            className={sortMode === 'installed-first' ? styles.filterActive : styles.filterBtn}
            onClick={() => setSortMode('installed-first')}
            aria-pressed={sortMode === 'installed-first'}
          >
            Installed first
          </button>
          <button
            type="button"
            className={sortMode === 'a-z' ? styles.filterActive : styles.filterBtn}
            onClick={() => setSortMode('a-z')}
            aria-pressed={sortMode === 'a-z'}
          >
            A–Z
          </button>
        </div>
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Genre (optional)</span>
        <div className={styles.genreFilters}>
          {CATALOG_GENRE_FILTERS.map((genre) => (
            <button
              key={genre}
              type="button"
              className={genreFilters.includes(genre) ? styles.genreChipActive : styles.genreChip}
              onClick={() => toggleGenre(genre)}
              aria-pressed={genreFilters.includes(genre)}
            >
              {genre}
            </button>
          ))}
          {genreFilters.length > 0 && (
            <button type="button" className={styles.clearGenresBtn} onClick={clearGenres}>
              Clear genres
            </button>
          )}
        </div>
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {quarantineCount > 0 && (
        <p className={styles.quarantineBanner} role="status">
          {quarantineCount} definition{quarantineCount === 1 ? '' : 's'} queued for re-verification after executable drift.
        </p>
      )}
      {loading && <p className={styles.loading}>Loading catalog…</p>}

      {!loading && visible.length === 0 && (
        <p className={styles.loading}>No games match your filters — try clearing genre chips or search.</p>
      )}

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
              installed={installedIds.has(entry.catalogGameId)}
              running={runningIds.has(entry.catalogGameId)}
              healthStatus={healthMap[entry.catalogGameId]?.status}
              onLaunch={handleLaunch}
              onExport={handleExportYaml}
              onThumbUp={handleThumbUp}
              onRequestVerification={handleRequestVerification}
              onNotify={handleNotifyWhenVerified}
            />
          )}
        />
      )}

      {loadingMore && <p className={styles.loading}>Loading more… ({entries.length} / {total})</p>}
    </div>
  );
}

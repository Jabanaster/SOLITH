import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import styles from './TrainerLibraryPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { VirtualCatalogGrid } from '../components/VirtualCatalogGrid.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import { getCatalogTagline } from '../../core/trainer-catalog/game-taglines.js';
import { ROADMAP_GENRE_FILTERS } from '../../core/trainer-catalog/catalog-genres.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import { resolveCatalogCoverUrl } from '../../core/trainer-catalog/cover-url.js';
import {
  projectPopularTrainerEntries,
  POPULAR_TRAINER_LIMIT,
  type TrainerCatalogPopularityEvidence,
} from '../../core/trainer-catalog/popular-ranking.js';
import {
  sortAllGamesEntries,
  ALL_GAMES_SORT_MODE_LABELS,
  type AllGamesSortMode,
} from '../../core/trainer-catalog/all-games-sorting.js';
import {
  filterTrainerLibraryEntries,
  TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS,
  TRAINER_LIBRARY_CATALOG_FILTER_LABELS,
  TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS,
  TRAINER_LIBRARY_MODE_FILTER_LABELS,
  type TrainerLibraryAvailabilityFilter,
  type TrainerLibraryCatalogFilter,
  type TrainerLibraryLauncherFilter,
  type TrainerLibraryModeFilter,
} from '../../core/trainer-catalog/all-games-filters.js';
import { describeCapabilityLanes } from '../../core/definitions/catalog-definition-capabilities.js';
import { COMMUNITY_WARNING_LABEL } from '../../core/trainer-catalog/community-trust.js';
import { isCommunityScanEntry, tierHint } from './trainer-library-verification-state.js';
import { fallbackArtworkTreatment } from './trainer-card-fallback-artwork.js';
import { isGenericTemplateEntry } from './trainer-catalog-generic-detection.js';
import { PublishDefinitionModal } from '../components/PublishDefinitionModal.js';
import type { SolithDefinitionV1 } from '../../core/definitions/schema.v1.js';
import {
  ctImportUiReducer,
  friendlyCtImportError,
  idleCtImportUiState,
} from '../../core/ct-library/import-state.js';

type TierFilter = 'all' | 'verified' | 'community' | 'metadata-only';
type SortMode = AllGamesSortMode;
/** ROADMAP §3.3 — Popular is the default Trainer Library view; All Games preserves prior unranked behavior. */
type ViewMode = 'popular' | 'all';
/** ROADMAP §3.4 — All Games first-use notice dismissal, persisted the same way as other local-only UI preferences. */
const ALL_GAMES_NOTICE_DISMISSED_KEY = 'trainerLibrary.allGamesNoticeDismissed';
const ALL_GAMES_NOTICE_TEXT =
  'All Games includes SOLITH’s full eligible catalog, including niche and less widely played titles. Use filters or search to narrow the list.';

const TRAINER_LIBRARY_FILTERS_KEY = 'trainerLibrary.filters';

interface RememberedTrainerLibraryFilters {
  availability: TrainerLibraryAvailabilityFilter[];
  catalog: TrainerLibraryCatalogFilter[];
  genres: string[];
  launcher: TrainerLibraryLauncherFilter[];
  mode: TrainerLibraryModeFilter[];
}

const EMPTY_REMEMBERED_FILTERS: RememberedTrainerLibraryFilters = {
  availability: [],
  catalog: [],
  genres: [],
  launcher: [],
  mode: [],
};

function readRememberedTrainerLibraryFilters(): RememberedTrainerLibraryFilters {
  try {
    const raw = window.sessionStorage.getItem(TRAINER_LIBRARY_FILTERS_KEY);
    if (!raw) return EMPTY_REMEMBERED_FILTERS;
    const parsed = JSON.parse(raw) as Partial<RememberedTrainerLibraryFilters>;
    const availability = Array.isArray(parsed.availability)
      ? parsed.availability.filter((value): value is TrainerLibraryAvailabilityFilter =>
          typeof value === 'string' && value in TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS,
        )
      : [];
    const catalog = Array.isArray(parsed.catalog)
      ? parsed.catalog.filter((value): value is TrainerLibraryCatalogFilter =>
          typeof value === 'string' && value in TRAINER_LIBRARY_CATALOG_FILTER_LABELS,
        )
      : [];
    const genres = Array.isArray(parsed.genres)
      ? parsed.genres.filter((value): value is string =>
          typeof value === 'string' && ROADMAP_GENRE_FILTERS.includes(value as (typeof ROADMAP_GENRE_FILTERS)[number]),
        )
      : [];
    const launcher = Array.isArray(parsed.launcher)
      ? parsed.launcher.filter((value): value is TrainerLibraryLauncherFilter =>
          typeof value === 'string' && value in TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS,
        )
      : [];
    const mode = Array.isArray(parsed.mode)
      ? parsed.mode.filter((value): value is TrainerLibraryModeFilter =>
          typeof value === 'string' && value in TRAINER_LIBRARY_MODE_FILTER_LABELS,
        )
      : [];
    return { availability, catalog, genres, launcher, mode };
  } catch {
    return EMPTY_REMEMBERED_FILTERS;
  }
}

function writeRememberedTrainerLibraryFilters(filters: RememberedTrainerLibraryFilters): void {
  try {
    window.sessionStorage.setItem(TRAINER_LIBRARY_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Session-only UI preference is best-effort; filters still work for the current render.
  }
}

function buildInstalledPlatformsMap(
  games: Array<{ catalogGameId?: string; platform: string }>,
): Map<string, Set<TrainerLibraryLauncherFilter>> {
  const map = new Map<string, Set<TrainerLibraryLauncherFilter>>();
  for (const game of games) {
    if (!game.catalogGameId || !(game.platform in TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS)) continue;
    const platform = game.platform as TrainerLibraryLauncherFilter;
    const existing = map.get(game.catalogGameId);
    if (existing) existing.add(platform);
    else map.set(game.catalogGameId, new Set([platform]));
  }
  return map;
}

function readAllGamesNoticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(ALL_GAMES_NOTICE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAllGamesNoticeDismissed(): void {
  try {
    window.localStorage.setItem(ALL_GAMES_NOTICE_DISMISSED_KEY, '1');
  } catch {
    // Local-only preference is best-effort; notice simply reappears next session.
  }
}

const DISCOVERY_PREVIEW_HEIGHT_KEY = 'solith:trainer-library:discovery-preview-height';
const DEFAULT_DISCOVERY_PREVIEW_HEIGHT = 288;
const MIN_DISCOVERY_PREVIEW_HEIGHT = 192;
const MAX_DISCOVERY_PREVIEW_HEIGHT = 900;

function initialDiscoveryPreviewHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_DISCOVERY_PREVIEW_HEIGHT;
  try {
    const stored = Number(window.sessionStorage.getItem(DISCOVERY_PREVIEW_HEIGHT_KEY));
    return Number.isFinite(stored)
      ? Math.min(MAX_DISCOVERY_PREVIEW_HEIGHT, Math.max(MIN_DISCOVERY_PREVIEW_HEIGHT, stored))
      : DEFAULT_DISCOVERY_PREVIEW_HEIGHT;
  } catch {
    return DEFAULT_DISCOVERY_PREVIEW_HEIGHT;
  }
}

function isLocallyAuthoredEntry(entry: TrainerCatalogEntry): boolean {
  return entry.sources.some(
    (source) => source.provider === 'user' || source.provider === 'ct-import',
  );
}

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

interface DiscoveryPreviewRecord {
  id: string;
  previewCandidateId: string;
  installIdentity: string;
  canonicalInstallPath: string;
  canonicalExecutablePath?: string;
  launcherAppId?: string;
  identityVersion: number;
  identityStatus: 'verified' | 'backfilled' | 'ambiguous' | 'legacy';
  needsReverification: boolean;
  catalogGameId?: string;
  catalogDisplayName?: string;
  platform: 'steam' | 'epic' | 'gog' | 'xbox' | 'manual';
  installPath: string;
  executablePath?: string;
  displayName?: string;
  steamAppId?: number;
  detectedAt: string;
  lastSeenAt: string;
  duplicate: boolean;
  duplicateReason?: 'same_executable_path' | 'same_launcher_app_id_and_path' | 'same_install_identity';
  duplicateOfId?: string;
  source: string;
  unsupportedReason?: string;
  classification: 'likely_game' | 'uncertain';
  classificationReason: string;
}

interface DiscoveryPreviewState {
  discovered: number;
  matched: number;
  platforms: Record<string, number>;
  scannedAt: string;
  records: DiscoveryPreviewRecord[];
  locationsChecked: string[];
  duplicatesSkipped: number;
  unsupported: number;
  rejected: Array<{ installPath: string; executablePath?: string; displayName?: string; reason: string }>;
  failures: Array<{ location: string; reason: string }>;
}

interface PickedCtPayload {
  filePath: string;
  xmlText: string;
  title: string;
  sha256: string;
}

const PAGE_SIZE = 120;

function newImportJobId(): string {
  return `ct-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


export function CatalogCard({
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
  onPublish,
  onToggleOwned,
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
  onPublish: (entry: TrainerCatalogEntry) => void;
  onToggleOwned?: (entry: TrainerCatalogEntry) => void;
}) {
  const coverUrl = resolveCatalogCoverUrl(entry);
  const communityScan = isCommunityScanEntry(entry);
  const fallback = fallbackArtworkTreatment(entry.displayName);
  const isStale = healthStatus === 'stale' || healthStatus === 'quarantined';
  const capabilitySummary = entry.capabilities ? describeCapabilityLanes(entry.capabilities) : undefined;
  // Remote-sync entries with no curated reference all get the exact same
  // fallback categories/cheat-count template (see remote-sync.ts) — showing
  // that as if it were real per-game data is what made the catalog look
  // like a wall of identical cards. Generic entries get a truthful label
  // instead; curated entries are completely unaffected.
  const isGeneric = isGenericTemplateEntry(entry);
  const supportingLine = isGeneric
    ? 'Community-sourced · details incomplete'
    : [
        entry.categories.slice(0, 2).join(' · ') || null,
        entry.hasModPack ? `${entry.cheatCount || '—'} cheats` : 'Metadata only',
      ]
        .filter(Boolean)
        .join(' · ');
  const trustSuffix = [
    trust?.positive ? `${trust.positive} confirmation${trust.positive === 1 ? '' : 's'}` : null,
    trust?.quarantined ? 'needs re-verify' : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
              const fallbackEl = img.nextElementSibling;
              if (fallbackEl) (fallbackEl as HTMLElement).style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={styles.coverFallback}
          style={{
            ...(coverUrl ? { display: 'none' } : undefined),
            ['--fallback-hue-a' as string]: fallback.hueA,
            ['--fallback-hue-b' as string]: fallback.hueB,
          }}
        >
          {/* Generic entries: no monogram. The letter is always the same
              character the title already leads with directly below — pure
              redundancy, not identity. And the category tag here was
              literally the same fabricated fallback categories now labeled
              "details incomplete" in the supporting line; showing "ACTION"
              on the banner while the body says the details are incomplete
              contradicted itself. Curated entries keep both — their
              category is real, and their monogram/title rarely share a
              cover-banner strip this way (curated entries have varied
              content below, not a one-line truthful-label placeholder). */}
          {!isGeneric && (
            <span className={styles.coverFallbackInitial} aria-hidden="true">
              {fallback.initial}
            </span>
          )}
          {!isGeneric && entry.categories[0] && (
            <span className={styles.coverCategoryTag} aria-hidden="true">
              {entry.categories[0]}
            </span>
          )}
        </div>
        {(installed || running) && (
          <span className={styles.presenceBadge}>
            {installed && running ? 'Installed · Running' : running ? 'Running' : 'Installed'}
          </span>
        )}
      </div>
      <div className={styles.cardBody}>
        <h2 className={styles.title} title={entry.displayName}>
          {entry.displayName}
        </h2>
        <p className={styles.supportingLine} title={capabilitySummary}>
          {supportingLine}
          {trustSuffix ? ` · ${trustSuffix}` : ''}
        </p>
        <div className={styles.statusRow}>
          {/* "community" and "metadata-only" are the expected default for
              most of the catalog, not a state worth a badge on every single
              card — that repetition is what made the badge read as vague
              filler. Only render it for a state actually worth flagging: a
              real problem (stale/quarantined) or the earned "verified" tier.
              The scan-required signal still lives in tierHint's tooltip and
              in the primary action's own (now neutral) label. */}
          {(isStale || entry.verificationStatus === 'verified') && (
            <span
              className={isStale ? styles.staleBadge : styles.tierBadge}
              data-tier={entry.verificationStatus}
              aria-label={!isStale && communityScan ? COMMUNITY_WARNING_LABEL : undefined}
              title={tierHint(entry)}
            >
              {isStale ? 'Needs re-verify' : entry.verificationStatus}
            </span>
          )}
        </div>
        <div className={styles.cardActions}>
          {/* Scan-required entries still open the same community discovery
              deck on click (behavior unchanged) — only the label changed,
              from a shouted "RUN COMMUNITY SCAN" repeated on nearly every
              card to a neutral, truthful "View Details". The scan step
              itself is what the deck opens into, not a separate action. */}
          <button
            type="button"
            className={communityScan ? styles.communityScanBtn : styles.launchBtn}
            onClick={() => void onLaunch(entry)}
            title={communityScan ? 'Opens trainer details; a community scan runs before any memory attach.' : undefined}
          >
            {communityScan || isGeneric ? 'View Details' : entry.hasModPack ? 'Open Trainer Deck' : 'View'}
          </button>
          {onToggleOwned && (
            <button
              type="button"
              className={entry.ownedConfirmed === true ? styles.filterActive : styles.secondaryBtn}
              onClick={() => onToggleOwned(entry)}
              aria-pressed={entry.ownedConfirmed === true}
              title="Deliberate local confirmation only — never inferred from installation or launcher detection."
            >
              {entry.ownedConfirmed === true ? 'Owned ✓' : 'Mark as owned'}
            </button>
          )}
          {entry.hasModPack && (
            <details className={styles.moreActions}>
              <summary>More actions</summary>
              <button type="button" className={styles.secondaryBtn} onClick={() => void onExport(entry)}>
                Export YAML
              </button>
              {isLocallyAuthoredEntry(entry) && (
                <button type="button" className={styles.secondaryBtn} onClick={() => void onPublish(entry)}>
                  Publish to Hub
                </button>
              )}
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
            </details>
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
  const [hubSyncing, setHubSyncing] = useState(false);
  const [communitySyncEnabled, setCommunitySyncEnabled] = useState(false);
  const [overwriteLocalDefs, setOverwriteLocalDefs] = useState(false);
  const [publishDefinition, setPublishDefinition] = useState<SolithDefinitionV1 | null>(null);
  const [message, setMessage] = useState('');
  const [rememberedFilters] = useState(readRememberedTrainerLibraryFilters);
  const [tierFilter] = useState<TierFilter>('all');
  const [availabilityFilters, setAvailabilityFilters] = useState<TrainerLibraryAvailabilityFilter[]>(rememberedFilters.availability);
  const [catalogFilters, setCatalogFilters] = useState<TrainerLibraryCatalogFilter[]>(rememberedFilters.catalog);
  const [genreFilters, setGenreFilters] = useState<string[]>(rememberedFilters.genres);
  const [launcherFilters, setLauncherFilters] = useState<TrainerLibraryLauncherFilter[]>(rememberedFilters.launcher);
  const [modeFilters, setModeFilters] = useState<TrainerLibraryModeFilter[]>(rememberedFilters.mode);
  const [importing, setImporting] = useState(false);
  const [ctImportState, dispatchCtImport] = useReducer(ctImportUiReducer, idleCtImportUiState);
  const [trustMeta, setTrustMeta] = useState<Record<string, TrustMeta>>({});
  const [quarantineCount, setQuarantineCount] = useState(0);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [installedPlatformsByCatalogGameId, setInstalledPlatformsByCatalogGameId] = useState<Map<string, Set<TrainerLibraryLauncherFilter>>>(new Map());
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [healthMap, setHealthMap] = useState<Record<string, { status: string }>>({});
  const [runningOnly, setRunningOnly] = useState(false);
  const [needsReverifyOnly, setNeedsReverifyOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('installed-first');
  const [viewMode, setViewMode] = useState<ViewMode>('popular');
  const [popularityMap, setPopularityMap] = useState<Map<string, TrainerCatalogPopularityEvidence>>(new Map());
  const [allTimePopularityMap, setAllTimePopularityMap] = useState<Map<string, number>>(new Map());
  const [catalogFilterUniverse, setCatalogFilterUniverse] = useState<TrainerCatalogEntry[] | null>(null);
  const [allGamesNoticeDismissed, setAllGamesNoticeDismissed] = useState(readAllGamesNoticeDismissed);
  const [dragOver, setDragOver] = useState(false);
  const [scanningInstalls, setScanningInstalls] = useState(false);
  const [addingSelectedInstalls, setAddingSelectedInstalls] = useState(false);
  const [installRootFolder, setInstallRootFolder] = useState('');
  const [discoveryPreview, setDiscoveryPreview] = useState<DiscoveryPreviewState | null>(null);
  const [selectedDiscoveryIds, setSelectedDiscoveryIds] = useState<Set<string>>(new Set());
  const [discoveryPreviewExpanded, setDiscoveryPreviewExpanded] = useState(false);
  const [discoveryPreviewHeight, setDiscoveryPreviewHeight] = useState(initialDiscoveryPreviewHeight);
  const discoveryPreviewListRef = useRef<HTMLDivElement>(null);
  const importYamlRef = useRef<HTMLInputElement>(null);
  const ctImportAbortRef = useRef<AbortController | null>(null);
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
    limit: number = PAGE_SIZE,
  ) => {
    if (!window.electronAPI?.trainerCatalogSearch) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      if (pageOffset === 0) await window.electronAPI.trainerCatalogSeed?.();
      const result = (await window.electronAPI.trainerCatalogSearch({
        query: searchQuery,
        limit,
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


  const fetchAllCandidatePages = useCallback(async (
    searchQuery: string,
    tier: TierFilter,
    genres: string[],
  ) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogSearch) return;
    setLoading(true);
    try {
      await api.trainerCatalogSeed?.();
      const all: TrainerCatalogEntry[] = [];
      let pageOffset = 0;
      let expectedTotal = Number.POSITIVE_INFINITY;
      while (pageOffset < expectedTotal) {
        const result = (await api.trainerCatalogSearch({
          query: searchQuery,
          limit: POPULAR_TRAINER_LIMIT,
          offset: pageOffset,
          verificationStatus: tier,
          categories: genres.length > 0 ? genres : undefined,
        })) as SearchResponse;
        if (!result.success || !result.entries) {
          setMessage(result.error ?? 'Search failed');
          return;
        }
        all.push(...result.entries);
        expectedTotal = result.total ?? all.length;
        pageOffset += POPULAR_TRAINER_LIMIT;
      }
      setEntries(all);
      // Every raw DB page has now been visited; report the actual eligible/search-matched
      // candidate count rather than the store's pre-eligibility SQL count.
      setTotal(all.length);
      setOffset(all.length);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const load = useCallback(async (
    searchQuery = query,
    tier: TierFilter = tierFilter,
    genres: string[] = genreFilters,
    view: ViewMode = viewMode,
    hasDerivedFilters = availabilityFilters.length > 0 || catalogFilters.length > 0 || launcherFilters.length > 0 || modeFilters.length > 0,
  ) => {
    setOffset(0);
    // §3.6 derived filters must see the complete search/genre candidate set;
    // otherwise a match beyond the first 120-row All Games page can be hidden.
    if (hasDerivedFilters) {
      await fetchAllCandidatePages(searchQuery, tier, genres);
      return;
    }
    // Popular is a bounded, non-paginated projection (ROADMAP §3.3 Step 9) — fetch
    // up to POPULAR_TRAINER_LIMIT in one page instead of the paginated PAGE_SIZE
    // used by All Games, so ranking always sees the full Popular candidate set.
    await fetchPage(searchQuery, 0, false, tier, genres, view === 'popular' ? POPULAR_TRAINER_LIMIT : PAGE_SIZE);
  }, [fetchAllCandidatePages, fetchPage, query, tierFilter, genreFilters, viewMode, availabilityFilters, catalogFilters, launcherFilters, modeFilters]);

  useEffect(() => {
    void load(
      query,
      tierFilter,
      genreFilters,
      viewMode,
      availabilityFilters.length > 0 || catalogFilters.length > 0 || launcherFilters.length > 0 || modeFilters.length > 0,
    );
  }, [tierFilter, genreFilters, viewMode, availabilityFilters, catalogFilters, launcherFilters, modeFilters]); // eslint-disable-line react-hooks/exhaustive-deps -- text search uses submit

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.catalogDemandList) return;
    void api.catalogDemandList().then((result) => {
      if (result.success && result.demand) {
        setPopularityMap(
          new Map(
            result.demand.map((d) => [
              d.catalogGameId,
              { notifyCount: d.notifyCount, verificationRequests: d.verificationRequests },
            ]),
          ),
        );
      }
    });
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogAllTimePopularityList) return;
    void api.trainerCatalogAllTimePopularityList().then((result) => {
      if (result.success && result.popularity) {
        setAllTimePopularityMap(new Map(result.popularity.map((p) => [p.catalogGameId, p.positiveCount])));
      }
    });
  }, []);


  useEffect(() => {
    writeRememberedTrainerLibraryFilters({
      availability: availabilityFilters,
      catalog: catalogFilters,
      genres: genreFilters,
      launcher: launcherFilters,
      mode: modeFilters,
    });
  }, [availabilityFilters, catalogFilters, genreFilters, launcherFilters, modeFilters]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogSearch) return;
    let cancelled = false;
    void (async () => {
      await api.trainerCatalogSeed?.();
      const all: TrainerCatalogEntry[] = [];
      let pageOffset = 0;
      let expectedTotal = Number.POSITIVE_INFINITY;
      while (!cancelled && pageOffset < expectedTotal) {
        const result = (await api.trainerCatalogSearch({
          query: '',
          limit: POPULAR_TRAINER_LIMIT,
          offset: pageOffset,
          verificationStatus: 'all',
        })) as SearchResponse;
        if (!result.success || !result.entries) return;
        all.push(...result.entries);
        expectedTotal = result.total ?? all.length;
        pageOffset += POPULAR_TRAINER_LIMIT;
      }
      if (!cancelled) setCatalogFilterUniverse(all);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getSettings) return;
    void api.getSettings().then((settings) => {
      setCommunitySyncEnabled(settings?.communitySyncEnabled === true);
    });
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.installDiscoveryList) return;
    void api.installDiscoveryList().then((result) => {
      if (result.success && result.catalogGameIds) {
        setInstalledIds(new Set(result.catalogGameIds));
      }
      if (result.success && result.games) {
        setInstalledPlatformsByCatalogGameId(buildInstalledPlatformsMap(result.games));
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
    if (list.success && list.games) {
      setInstalledPlatformsByCatalogGameId(buildInstalledPlatformsMap(list.games));
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
    // Popular is a bounded, non-paginated projection (Step 9) — appending further
    // pages here would mix an unranked tail into the ranked/limited Popular set.
    if (viewMode === 'popular') return;
    if (loadingMore || loading || entries.length >= total) return;
    void fetchPage(
      queryRef.current,
      offset,
      true,
      tierFilterRef.current,
      genreFiltersRef.current,
    );
  }, [viewMode, loadingMore, loading, entries.length, total, offset, fetchPage]);

  const toggleGenre = (genre: string) => {
    setGenreFilters((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );
  };

  const clearGenres = () => setGenreFilters([]);

  const toggleAvailabilityFilter = (filter: TrainerLibraryAvailabilityFilter) => {
    setAvailabilityFilters((prev) =>
      prev.includes(filter) ? prev.filter((value) => value !== filter) : [...prev, filter],
    );
  };

  const toggleCatalogFilter = (filter: TrainerLibraryCatalogFilter) => {
    setCatalogFilters((prev) =>
      prev.includes(filter) ? prev.filter((value) => value !== filter) : [...prev, filter],
    );
  };

  const toggleLauncherFilter = (filter: TrainerLibraryLauncherFilter) => {
    setLauncherFilters((prev) =>
      prev.includes(filter) ? prev.filter((value) => value !== filter) : [...prev, filter],
    );
  };

  const toggleModeFilter = (filter: TrainerLibraryModeFilter) => {
    setModeFilters((prev) =>
      prev.includes(filter) ? prev.filter((value) => value !== filter) : [...prev, filter],
    );
  };

  const handleToggleOwned = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogSetOwned) return;
    const nextOwned = entry.ownedConfirmed !== true;
    const result = await api.trainerCatalogSetOwned({ catalogGameId: entry.catalogGameId, owned: nextOwned });
    if (result.success) {
      setEntries((prev) =>
        prev.map((e) => (e.catalogGameId === entry.catalogGameId ? { ...e, ownedConfirmed: result.ownedConfirmed ?? nextOwned } : e)),
      );
    } else {
      setMessage(result.error ?? 'Failed to update ownership.');
    }
  };

  const handleScanInstalled = async () => {
    const api = window.electronAPI;
    if (!api?.installDiscoveryPreview) return;
    setScanningInstalls(true);
    setMessage('');
    try {
      await api.trainerCatalogSeed?.();
      const result = await api.installDiscoveryPreview({
        includeCommonRoots: true,
        userSelectedRoots: installRootFolder ? [installRootFolder] : undefined,
      });
      if (result.success) {
        const preview: DiscoveryPreviewState = {
          discovered: result.discovered ?? 0,
          matched: result.matched ?? 0,
          platforms: result.platforms ?? {},
          scannedAt: result.scannedAt ?? new Date().toISOString(),
          records: result.records ?? [],
          locationsChecked: result.locationsChecked ?? [],
          duplicatesSkipped: result.duplicatesSkipped ?? 0,
          unsupported: result.unsupported ?? 0,
          rejected: result.rejected ?? [],
          failures: result.failures ?? [],
        };
        setDiscoveryPreview(preview);
        setSelectedDiscoveryIds(
          new Set(
            preview.records
              .filter((record) => !record.duplicate && record.classification === 'likely_game')
              .map((record) => record.previewCandidateId),
          ),
        );
        setMessage(
          `Preview ready — ${preview.discovered} installs found, ${preview.matched} catalog matches. Review before adding.`,
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

  const handleToggleCommunitySync = async (enabled: boolean) => {
    setCommunitySyncEnabled(enabled);
    try {
      await window.electronAPI?.setSetting?.('communitySyncEnabled', enabled);
      setMessage(
        enabled
          ? 'Community Hub sync enabled — main process will poll for definition deltas.'
          : 'Community Hub sync disabled — no Hub network activity.',
      );
    } catch {
      setCommunitySyncEnabled(!enabled);
      setMessage('Failed to update Community Hub sync setting.');
    }
  };

  const handleHubSync = async () => {
    if (!window.electronAPI?.trainerCatalogSyncHub) return;
    if (!communitySyncEnabled) {
      setMessage('Enable Community Hub sync before syncing definitions.');
      return;
    }
    if (overwriteLocalDefs) {
      const confirmed = window.confirm(
        'Overwrite local user/CT definitions with Hub copies? This cannot be undone from Solith.',
      );
      if (!confirmed) {
        setOverwriteLocalDefs(false);
        return;
      }
    }
    setHubSyncing(true);
    setMessage('');
    try {
      const result = await window.electronAPI.trainerCatalogSyncHub({
        overwriteUserDefinitions: overwriteLocalDefs,
      });
      setOverwriteLocalDefs(false);
      if (result.success && result.report) {
        setMessage(
          `Hub sync: imported ${result.report.imported}, preserved ${result.report.skippedUserDefinitions} local, rejected ${result.report.rejected}.`,
        );
        await load(query);
      } else if (result.report?.status === 'disabled') {
        setMessage('Hub sync is disabled — enable Community Hub sync first.');
      } else {
        setMessage(result.error ?? 'Hub sync failed');
      }
    } finally {
      setHubSyncing(false);
    }
  };

  const handlePublish = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogGetDefinition) return;
    const result = await api.trainerCatalogGetDefinition({ catalogGameId: entry.catalogGameId });
    if (!result.success || !result.definition) {
      setMessage(result.error ?? 'No definition payload found to publish.');
      return;
    }
    if (result.canPublish === false) {
      setMessage('Only locally authored or CT-imported definitions can be published.');
      return;
    }
    if (!communitySyncEnabled) {
      setMessage('Enable Community Hub sync in the Catalog panel before publishing.');
      return;
    }
    setPublishDefinition(result.definition);
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

  const handleImportCt = async (picked: PickedCtPayload) => {
    if (!window.electronAPI?.trainerCatalogImportCt || !window.electronAPI?.trainerCatalogPreviewCt) return;
    const controller = new AbortController();
    const jobId = newImportJobId();
    ctImportAbortRef.current = controller;
    dispatchCtImport({ type: 'start', jobId, label: 'Hashing Source...' });
    setImporting(true);
    setMessage('');
    try {
      if (controller.signal.aborted) {
        throw new DOMException('Import cancelled by user.', 'AbortError');
      }
      dispatchCtImport({
        type: 'progress',
        progress: {
          jobId,
          phase: 'parsing-xml',
          label: 'Parsing XML...',
          processedTables: 0,
          totalTables: 1,
        },
      });
      const preview = await window.electronAPI.trainerCatalogPreviewCt(picked);
      if (!preview.success) {
        const detail = preview.errors?.join('; ') ?? preview.error ?? 'CT preview failed';
        dispatchCtImport({ type: 'failed', errorMessage: detail });
        setMessage(detail);
        return;
      }
      dispatchCtImport({
        type: 'progress',
        progress: {
          jobId,
          phase: 'scraping-signatures',
          label: 'Scraping Signatures...',
          processedTables: 1,
          totalTables: 1,
        },
      });
      const confirmed = window.confirm(
        [
          `Import "${preview.title ?? picked.title}" as inert Solith metadata?`,
          '',
          `Source hash: ${(preview.sourceHash ?? picked.sha256).slice(0, 16)}...`,
          `Accepted pointer/metadata rows: ${preview.acceptedCount ?? 0}`,
          `Rejected or neutralized rows: ${preview.rejectedCount ?? 0}`,
          `Script research records: ${preview.scriptAnalysisCount ?? 0}`,
          '',
          'Solith will preserve CT research metadata only. It will not execute Auto Assembler, Lua, shell commands, or memory writes.',
        ].join('\n'),
      );
      if (!confirmed) {
        dispatchCtImport({ type: 'cancelled', errorCode: 'USER_DECLINED_CT_IMPORT' });
        setMessage('CT import cancelled before writing metadata.');
        return;
      }
      const result = await window.electronAPI.trainerCatalogImportCt({
        xmlText: picked.xmlText,
        title: picked.title,
      });
      if (result.success) {
        dispatchCtImport({
          type: 'complete',
          progress: {
            jobId,
            phase: 'complete',
            label: 'Import Complete.',
            processedTables: 1,
            totalTables: 1,
          },
        });
        setMessage(
          `Imported "${result.title ?? picked.title}" — ${result.acceptedCount ?? 0} accepted, ${result.rejectedCount ?? 0} rejected.`,
        );
        await load(query);
      } else {
        const detail = result.errors?.join('; ') ?? result.error ?? 'Import failed';
        dispatchCtImport({ type: 'failed', errorMessage: detail });
        setMessage(detail);
      }
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (isAbort) {
        dispatchCtImport({ type: 'cancelled', errorCode: 'ABORT_ERR' });
        setMessage(friendlyCtImportError('ABORT_ERR'));
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        dispatchCtImport({ type: 'failed', errorMessage: detail });
        setMessage(detail);
      }
    } finally {
      setImporting(false);
      ctImportAbortRef.current = null;
    }
  };

  const handlePickAndImportCt = async () => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogPickCt) return;
    dispatchCtImport({ type: 'reset' });
    setMessage('');
    const picked = await api.trainerCatalogPickCt();
    if (picked.canceled) return;
    if (!picked.success || !picked.filePath || !picked.xmlText || !picked.title || !picked.sha256) {
      const detail = picked.error ?? 'Could not pick CT file.';
      dispatchCtImport({ type: 'failed', errorMessage: detail });
      setMessage(detail);
      return;
    }
    await handleImportCt({
      filePath: picked.filePath,
      xmlText: picked.xmlText,
      title: picked.title,
      sha256: picked.sha256,
    });
  };

  const handlePickInstallRoot = async () => {
    const result = await window.electronAPI?.installDiscoveryPickFolder?.();
    if (result?.success && result.folderPath) {
      setInstallRootFolder(result.folderPath);
      setMessage(`Scan root selected: ${result.folderPath}`);
    } else if (result && !result.canceled) {
      setMessage(result.error ?? 'Could not select scan root.');
    }
  };

  const handleAddSelectedInstalls = async () => {
    const api = window.electronAPI;
    if (!api?.installDiscoveryCommit || !discoveryPreview) return;
    const records = discoveryPreview.records
      .filter((record) => selectedDiscoveryIds.has(record.previewCandidateId) && !record.duplicate)
      .map(({ platform, installPath, executablePath, displayName, steamAppId, launcherAppId }) => ({
        platform,
        installPath,
        executablePath,
        displayName,
        steamAppId,
        launcherAppId,
      }));
    if (records.length === 0) {
      setMessage('No non-duplicate installs selected to add.');
      return;
    }
    const confirmed = window.confirm(
      `Add ${records.length} selected local install${records.length === 1 ? '' : 's'} to Solith? This only records local metadata and does not attach to or modify games.`,
    );
    if (!confirmed) return;
    setAddingSelectedInstalls(true);
    try {
      const result = await api.installDiscoveryCommit({ records });
      if (!result.success) {
        setMessage('Unable to add selected games because the preview data is no longer valid. Run discovery again.');
        return;
      }
      await refreshInstalledList();
      const health = await api.trainerHealthCheck?.();
      if (health?.success && health.map) setHealthMap(health.map);
      setDiscoveryPreview((prev) => prev
        ? {
            ...prev,
            records: prev.records.map((record) =>
              selectedDiscoveryIds.has(record.previewCandidateId) ? { ...record, duplicate: true } : record,
            ),
          }
        : prev);
      setSelectedDiscoveryIds(new Set());
      setMessage(`Added ${result.added ?? 0}; skipped ${result.skipped ?? 0} existing installs.`);
    } finally {
      setAddingSelectedInstalls(false);
    }
  };

  const rememberDiscoveryPreviewHeight = () => {
    if (discoveryPreviewExpanded) return;
    const height = Math.round(discoveryPreviewListRef.current?.getBoundingClientRect().height ?? 0);
    if (height < MIN_DISCOVERY_PREVIEW_HEIGHT) return;
    const bounded = Math.min(MAX_DISCOVERY_PREVIEW_HEIGHT, height);
    setDiscoveryPreviewHeight(bounded);
    try {
      window.sessionStorage.setItem(DISCOVERY_PREVIEW_HEIGHT_KEY, String(bounded));
    } catch {
      // Session persistence is optional; resizing still works without storage access.
    }
  };

  const handleCancelCtImport = () => {
    ctImportAbortRef.current?.abort();
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
    onLaunchGame?.(
      entry.catalogGameId,
      entry.displayName,
      loadResult.capabilities ?? undefined,
    );
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

  const popularCatalogGameIds = useMemo(
    () => catalogFilterUniverse === null
      ? undefined
      : new Set(
          projectPopularTrainerEntries(catalogFilterUniverse, {
            installedCatalogGameIds: installedIds,
            popularityByCatalogGameId: popularityMap,
          }).map((ranked) => ranked.entry.catalogGameId),
        ),
    [catalogFilterUniverse, installedIds, popularityMap],
  );

  const legacyStatusFilteredEntries = entries.filter((e) => {
    if (runningOnly && !runningIds.has(e.catalogGameId)) return false;
    if (needsReverifyOnly && !entryNeedsReverify(e.catalogGameId)) return false;
    return true;
  });

  const filteredEntries = filterTrainerLibraryEntries(
    legacyStatusFilteredEntries,
    { availability: availabilityFilters, catalog: catalogFilters, launcher: launcherFilters, mode: modeFilters },
    { installedCatalogGameIds: installedIds, popularCatalogGameIds, installedPlatformsByCatalogGameId },
  );

  const visible = viewMode === 'popular'
    ? projectPopularTrainerEntries(filteredEntries, {
        installedCatalogGameIds: installedIds,
        popularityByCatalogGameId: popularityMap,
      }).map((ranked) => ranked.entry)
    : sortAllGamesEntries(filteredEntries, sortMode, {
        installedCatalogGameIds: installedIds,
        popularityByCatalogGameId: popularityMap,
        allTimePopularityByCatalogGameId: allTimePopularityMap,
      });

  const activeFilterSummary =
    [
      viewMode === 'popular' ? 'Popular' : 'All Games',
      availabilityFilters.length > 0
        ? availabilityFilters.map((filter) => TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS[filter]).join(', ')
        : null,
      catalogFilters.length > 0
        ? catalogFilters.map((filter) => TRAINER_LIBRARY_CATALOG_FILTER_LABELS[filter]).join(', ')
        : null,
      launcherFilters.length > 0
        ? launcherFilters.map((filter) => TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS[filter]).join(', ')
        : null,
      modeFilters.length > 0
        ? modeFilters.map((filter) => TRAINER_LIBRARY_MODE_FILTER_LABELS[filter]).join(', ')
        : null,
      genreFilters.length > 0 ? genreFilters.join(', ') : null,
      runningOnly ? 'running' : null,
      needsReverifyOnly ? 'needs re-verify' : null,
      viewMode === 'all' && sortMode !== 'installed-first' ? ALL_GAMES_SORT_MODE_LABELS[sortMode] : null,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  const hasActiveLibraryFilters =
    availabilityFilters.length > 0 ||
    catalogFilters.length > 0 ||
    launcherFilters.length > 0 ||
    modeFilters.length > 0 ||
    genreFilters.length > 0 ||
    runningOnly ||
    needsReverifyOnly;

  const handleDismissAllGamesNotice = () => {
    setAllGamesNoticeDismissed(true);
    writeAllGamesNoticeDismissed();
  };

  const resetLibraryFilters = () => {
    setAvailabilityFilters([]);
    setCatalogFilters([]);
    setLauncherFilters([]);
    setModeFilters([]);
    setGenreFilters([]);
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
        artwork="trainerLibraryStopwatchClipboard"
        className={styles.header}
        title="Trainer Library"
        description={`${total.toLocaleString()} games${activeFilterSummary ? ` · ${activeFilterSummary}` : ''} · virtualized grid`}
        walkthroughId="trainer-library"
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
            <button
              id="trainer-library-scan-installed"
              type="button"
              className={styles.syncBtn}
              onClick={() => void handleScanInstalled()}
              disabled={scanningInstalls}
            >
              {scanningInstalls ? 'Scanning…' : 'Scan installed games'}
            </button>
            <button
              id="trainer-library-import-ct"
              type="button"
              className={styles.syncBtn}
              onClick={() => void handlePickAndImportCt()}
              disabled={importing}
            >
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

      <section className={styles.hubPanel} aria-labelledby="community-hub-heading">
        <div className={styles.hubPanelHeader}>
          <h2 id="community-hub-heading">Solith Definition Hub</h2>
          <label className={styles.hubToggle}>
            <input
              type="checkbox"
              checked={communitySyncEnabled}
              onChange={(e) => void handleToggleCommunitySync(e.target.checked)}
            />
            Community sync enabled
          </label>
        </div>
        <p className={styles.hubCopy}>
          {communitySyncEnabled
            ? 'Opted in — Solith will delta-fetch JSON definitions from the Hub. L0 stays Scan-Required; Offline Confirm is still required before attach.'
            : 'Disabled by default — no Hub network requests and no polling interval while off.'}
        </p>
        <div className={styles.hubActions}>
          <button
            type="button"
            className={styles.syncBtn}
            onClick={() => void handleHubSync()}
            disabled={hubSyncing || !communitySyncEnabled}
          >
            {hubSyncing ? 'Syncing Hub…' : 'Sync Hub now'}
          </button>
          <label className={styles.hubOverwrite}>
            <input
              type="checkbox"
              checked={overwriteLocalDefs}
              disabled={!communitySyncEnabled || hubSyncing}
              onChange={(e) => setOverwriteLocalDefs(e.target.checked)}
            />
            Overwrite local definitions (requires confirm)
          </label>
        </div>
      </section>

      {ctImportState.status !== 'idle' && (
        <section
          className={`${styles.importPanel} ${ctImportState.status === 'failed' ? styles.importPanelError : ''}`}
          aria-live="polite"
          aria-labelledby="ct-import-status-heading"
        >
          <div>
            <h2 id="ct-import-status-heading">CT Import Status</h2>
            <p>
              {ctImportState.errorMessage ??
                ctImportState.progress?.label ??
                'Preparing metadata-only CT import...'}
            </p>
            {typeof ctImportState.progress?.processedTables === 'number' && (
              <small>
                Tables processed: {ctImportState.progress.processedTables}
                {typeof ctImportState.progress.totalTables === 'number'
                  ? ` / ${ctImportState.progress.totalTables}`
                  : ''}
              </small>
            )}
          </div>
          <div className={styles.importActions}>
            {ctImportState.status === 'running' && (
              <button type="button" className={styles.cancelImportBtn} onClick={handleCancelCtImport}>
                Cancel Import
              </button>
            )}
            {(ctImportState.status === 'failed' || ctImportState.status === 'cancelled' || ctImportState.status === 'complete') && (
              <button
                type="button"
                className={styles.syncBtn}
                onClick={() => {
                  dispatchCtImport({ type: 'reset' });
                  void handlePickAndImportCt();
                }}
              >
                Retry / Import Another CT
              </button>
            )}
          </div>
        </section>
      )}

      <section
        id="trainer-library-discovery-preview"
        className={styles.scanPreviewPanel}
        aria-labelledby="install-discovery-preview-heading"
      >
        <div className={styles.scanPreviewHeader}>
          <div>
            <h2 id="install-discovery-preview-heading">Installed Game Discovery</h2>
            <p>
              Local-only scan preview. Solith records selected installs only after confirmation; it does not attach to or modify games.
            </p>
          </div>
          <div className={styles.scanPreviewActions}>
            <button
              id="trainer-library-choose-scan-folder"
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void handlePickInstallRoot()}
            >
              Choose scan folder
            </button>
            <button
              id="trainer-library-run-discovery-preview"
              type="button"
              className={styles.syncBtn}
              onClick={() => void handleScanInstalled()}
              disabled={scanningInstalls}
            >
              {scanningInstalls ? 'Scanning…' : 'Run discovery preview'}
            </button>
          </div>
        </div>
        {installRootFolder && (
          <p className={styles.scanRoot} title={installRootFolder}>
            Extra root: {installRootFolder}
          </p>
        )}
        {discoveryPreview && (
          <>
            <div className={styles.scanSummary}>
              <span>{discoveryPreview.discovered} plausible games</span>
              <span>{discoveryPreview.matched} matched</span>
              <span>{discoveryPreview.duplicatesSkipped} duplicates</span>
              <span>{discoveryPreview.rejected.length} rejected non-games</span>
            </div>
            <div className={styles.scanPreviewActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                aria-expanded={discoveryPreviewExpanded}
                aria-controls="trainer-library-discovery-records"
                onClick={() => setDiscoveryPreviewExpanded((expanded) => !expanded)}
              >
                {discoveryPreviewExpanded ? 'Collapse preview' : 'Expand preview'}
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() =>
                  setSelectedDiscoveryIds(new Set(discoveryPreview.records.filter((record) => !record.duplicate && record.classification === 'likely_game').map((record) => record.previewCandidateId)))
                }
              >
                Select all new
              </button>
              <button type="button" className={styles.secondaryBtn} onClick={() => setSelectedDiscoveryIds(new Set())}>
                Deselect all
              </button>
              <button
                type="button"
                className={styles.syncBtn}
                onClick={() => void handleAddSelectedInstalls()}
                disabled={addingSelectedInstalls || selectedDiscoveryIds.size === 0}
              >
                {addingSelectedInstalls ? 'Adding…' : `Add selected (${selectedDiscoveryIds.size})`}
              </button>
            </div>
            <div
              id="trainer-library-discovery-records"
              ref={discoveryPreviewListRef}
              className={`${styles.scanRecordList}${discoveryPreviewExpanded ? ` ${styles.scanRecordListExpanded}` : ''}`}
              style={discoveryPreviewExpanded ? undefined : { height: `${discoveryPreviewHeight}px` }}
              onPointerUp={rememberDiscoveryPreviewHeight}
            >
              {discoveryPreview.records.length === 0 ? (
                <p>No local installs were found in the checked locations.</p>
              ) : (
                discoveryPreview.records.slice(0, 60).map((record) => (
                  <label
                    key={record.previewCandidateId}
                    className={`${styles.scanRecord}${record.duplicate ? ` ${styles.scanRecordMuted}` : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDiscoveryIds.has(record.previewCandidateId)}
                      disabled={record.duplicate}
                      onChange={(event) => {
                        setSelectedDiscoveryIds((prev) => {
                          const next = new Set(prev);
                          if (event.target.checked) next.add(record.previewCandidateId);
                          else next.delete(record.previewCandidateId);
                          return next;
                        });
                      }}
                    />
                    <span>
                      <strong>{record.catalogDisplayName ?? record.displayName ?? record.catalogGameId ?? 'Unmatched local executable'}</strong>
                      <small>{record.platform} · {record.installPath}</small>
                      {record.duplicate && (
                        <small>
                          Already in local library
                          {record.duplicateReason ? ` (${record.duplicateReason.replace(/_/g, ' ')})` : ''}
                        </small>
                      )}
                      <small>{record.classification === 'uncertain' ? 'Uncertain: ' + record.classificationReason : 'Likely game: ' + record.classificationReason}</small>
                      {record.unsupportedReason && <small>Reason: {record.unsupportedReason}</small>}
                    </span>
                  </label>
                ))
              )}
            </div>
            <details className={styles.scanDiagnostics}>
              <summary>Scan locations and diagnostics</summary>
              <ul>
                {discoveryPreview.locationsChecked.map((location) => (
                  <li key={location}>{location}</li>
                ))}
              </ul>
              {discoveryPreview.rejected.length > 0 && (
                <>
                  <strong>Rejected non-games</strong>
                  <ul>
                    {discoveryPreview.rejected.map((record) => (
                      <li key={record.installPath + record.reason}>{record.installPath}: {record.reason}</li>
                    ))}
                  </ul>
                </>
              )}              {discoveryPreview.failures.length > 0 && (
                <>
                  <strong>Failures</strong>
                  <ul>
                    {discoveryPreview.failures.map((failure) => (
                      <li key={`${failure.location}:${failure.reason}`}>
                        {failure.location}: {failure.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          </>
        )}
      </section>

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
        <span className={styles.filterLabel}>Availability</span>
        <div className={styles.filters}>
          {(Object.entries(TRAINER_LIBRARY_AVAILABILITY_FILTER_LABELS) as Array<[TrainerLibraryAvailabilityFilter, string]>).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              className={availabilityFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
              onClick={() => toggleAvailabilityFilter(filter)}
              aria-pressed={availabilityFilters.includes(filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Status (existing)</span>
        <div className={styles.filters}>
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

      <div className={styles.filterSection} role="group" aria-labelledby="trainer-library-view-label">
        <span id="trainer-library-view-label" className={styles.filterLabel}>View</span>
        <div className={styles.filters}>
          <button
            id="trainer-library-view-popular"
            type="button"
            className={viewMode === 'popular' ? styles.filterActive : styles.filterBtn}
            onClick={() => setViewMode('popular')}
            aria-pressed={viewMode === 'popular'}
          >
            Popular
          </button>
          <button
            id="trainer-library-view-all"
            type="button"
            className={viewMode === 'all' ? styles.filterActive : styles.filterBtn}
            onClick={() => setViewMode('all')}
            aria-pressed={viewMode === 'all'}
          >
            All Games
          </button>
        </div>
      </div>

      {viewMode === 'all' && !allGamesNoticeDismissed && (
        <p
          id="trainer-library-all-games-notice"
          className={styles.allGamesNotice}
          role="status"
        >
          {ALL_GAMES_NOTICE_TEXT}
          <button
            type="button"
            className={styles.allGamesNoticeDismiss}
            onClick={handleDismissAllGamesNotice}
            aria-label="Dismiss All Games notice"
          >
            Dismiss
          </button>
        </p>
      )}

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Mode</span>
        <div className={styles.filters}>
          {(Object.entries(TRAINER_LIBRARY_MODE_FILTER_LABELS) as Array<[TrainerLibraryModeFilter, string]>).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              className={modeFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
              onClick={() => toggleModeFilter(filter)}
              aria-pressed={modeFilters.includes(filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Catalog</span>
        <div className={styles.filters}>
          {(Object.entries(TRAINER_LIBRARY_CATALOG_FILTER_LABELS) as Array<[TrainerLibraryCatalogFilter, string]>).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              className={catalogFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
              onClick={() => toggleCatalogFilter(filter)}
              aria-pressed={catalogFilters.includes(filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Launcher</span>
        <div className={styles.filters}>
          {(Object.entries(TRAINER_LIBRARY_LAUNCHER_FILTER_LABELS) as Array<[TrainerLibraryLauncherFilter, string]>).map(([filter, label]) => (
            <button
              key={filter}
              type="button"
              className={launcherFilters.includes(filter) ? styles.filterActive : styles.filterBtn}
              onClick={() => toggleLauncherFilter(filter)}
              aria-pressed={launcherFilters.includes(filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'all' && (
        <div className={styles.filterSection}>
          <span className={styles.filterLabel}>Sort</span>
          <div className={styles.filters}>
            <button
              type="button"
              className={sortMode === 'recommended' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('recommended')}
              aria-pressed={sortMode === 'recommended'}
            >
              Recommended
            </button>
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
            <button
              type="button"
              className={sortMode === 'verified-first' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('verified-first')}
              aria-pressed={sortMode === 'verified-first'}
            >
              Verified first
            </button>
            <button
              type="button"
              className={sortMode === 'popular-now' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('popular-now')}
              aria-pressed={sortMode === 'popular-now'}
            >
              Popular now
            </button>
            <button
              type="button"
              className={sortMode === 'most-trainer-options' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('most-trainer-options')}
              aria-pressed={sortMode === 'most-trainer-options'}
            >
              Most trainer options
            </button>
            <button
              type="button"
              className={sortMode === 'all-time-popular' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('all-time-popular')}
              aria-pressed={sortMode === 'all-time-popular'}
            >
              All-time popular
            </button>
            <button
              type="button"
              className={sortMode === 'newest-release' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('newest-release')}
              aria-pressed={sortMode === 'newest-release'}
            >
              Newest release
            </button>
            <button
              type="button"
              className={sortMode === 'recently-added' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('recently-added')}
              aria-pressed={sortMode === 'recently-added'}
            >
              Recently added to SOLITH
            </button>
            <button
              type="button"
              className={sortMode === 'recently-updated' ? styles.filterActive : styles.filterBtn}
              onClick={() => setSortMode('recently-updated')}
              aria-pressed={sortMode === 'recently-updated'}
            >
              Recently updated
            </button>
          </div>
        </div>
      )}

      <div className={styles.filterSection}>
        <span className={styles.filterLabel}>Genre (optional)</span>
        <div className={styles.genreFilters}>
          {ROADMAP_GENRE_FILTERS.map((genre) => (
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

      <div className={styles.filterSection} role="status" aria-live="polite">
        <span className={styles.filterLabel}>
          {visible.length.toLocaleString()} result{visible.length === 1 ? '' : 's'} shown
          {entries.length < total ? ` from ${entries.length.toLocaleString()} loaded` : ''}
        </span>
        {hasActiveLibraryFilters && (
          <button type="button" className={styles.clearGenresBtn} onClick={resetLibraryFilters}>
            Reset
          </button>
        )}
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
          backToTopClassName={styles.backToTopBtn}
          backToTopLabel="Back to top"
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
              onPublish={handlePublish}
              onToggleOwned={handleToggleOwned}
            />
          )}
        />
      )}

      {loadingMore && <p className={styles.loading}>Loading more… ({entries.length} / {total})</p>}

      {publishDefinition && (
        <PublishDefinitionModal
          definition={publishDefinition}
          onClose={() => setPublishDefinition(null)}
          onPublished={(id) => {
            setPublishDefinition(null);
            setMessage(`Published to the Solith Hub as L0 Community definition ${id}.`);
          }}
        />
      )}
    </div>
  );
}

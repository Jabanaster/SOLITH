import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import styles from './TrainerLibraryPage.module.css';
import { PageModuleHeader } from '../components/PageModuleHeader.js';
import { VirtualCatalogGrid } from '../components/VirtualCatalogGrid.js';
import { SectionVirtualGrid } from '../components/SectionVirtualGrid.js';
import { ViewModeToggle, type LibraryViewMode } from '../components/ViewModeToggle.js';
import { downloadTextFile } from '../utils/download-text-file.js';
import { getCatalogTagline } from '../../core/trainer-catalog/game-taglines.js';
import { ROADMAP_GENRE_FILTERS } from '../../core/trainer-catalog/catalog-genres.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import { toSafeDisplayText } from '../../shared/safe-display-text.js';
import { resolveCatalogHeaderUrl } from '../../core/trainer-catalog/cover-url.js';
import {
  projectPopularTrainerEntries,
  POPULAR_TRAINER_LIMIT,
  type TrainerCatalogPopularityEvidence,
} from '../../core/trainer-catalog/popular-ranking.js';
// Owner-directed reversal of the Mission 3/24 sort freeze (see
// tests/trainer-library-sort-ui.test.ts header comment): a real Sort control
// is back, scoped to the flat/All-Games browse view only (see
// trainer-library-sort-options.ts).
import {
  DEFAULT_TRAINER_LIBRARY_SORT_OPTION,
  sortTrainerLibraryFlatEntries,
  type TrainerLibrarySortOption,
} from './trainer-library-sort-options.js';
import type { AllGamesSortContext } from '../../core/trainer-catalog/all-games-sorting.js';
import { TrainerLibrarySortMenu } from './TrainerLibrarySortMenu.js';
import { TrainerLibraryQuickTabs, type TrainerLibraryQuickTab } from './TrainerLibraryQuickTabs.js';
import { TrainerLibraryFiltersPopover } from './TrainerLibraryFiltersPopover.js';
import { TrainerLibraryActiveFilterChips } from './TrainerLibraryActiveFilterChips.js';
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
import {
  organizeLibrary,
  sortLibraryAZ,
  LIBRARY_SECTION_ORDER,
  LIBRARY_SECTION_LABELS,
  LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT,
  type LibraryGameEvidence,
  type LibrarySectionKey,
} from '../../core/trainer-catalog/library-sections.js';
// Mission 10 (Personal Library Completion pass, Phase 2) — the accuracy
// badge sources its value from Phase 1's real computeTrainerAccuracy, never
// a new invented computation. See TRAINER_ACCURACY_BADGE_LABELS below for
// which states are worth a badge at all.
import {
  computeTrainerAccuracy,
  type TrainerAccuracyState,
} from '../../core/trainer-catalog/trainer-accuracy.js';
// Mission 6 (validation receipts -> accuracy badge integration gap) — the
// pure receipt-evidence bridge (no I/O; see its header comment) plus a
// type-only import of the receipt shape. `store.js` itself is never
// imported at runtime here (it pulls in the Node-only `better-sqlite3` main-
// process database) — only its exported TYPE crosses into the renderer.
import { deriveReceiptEvidence } from '../../core/validation-receipts/receipt-evidence.js';
import type { ValidationReceipt } from '../../core/validation-receipts/store.js';
// Personal Library Completion — Final Closure Pass, Mission 5 REVERSAL
// (2026-09-10): the owner explicitly rejected the "Show N more" chunking
// approach below in favor of real virtualization. trainer-library-section-
// chunking.ts's pure functions are no longer imported/wired here — see
// SectionVirtualGrid (../components/SectionVirtualGrid.js) for the
// replacement, and tests/trainer-library-virtualization-coverage.test.ts for
// the updated proof. The chunking module and its own pure-logic test file
// are left in place (unused by this page) rather than deleted, since they
// still document/prove the now-superseded approach's own bounded-growth
// logic in isolation.

type TierFilter = 'all' | 'verified' | 'community' | 'metadata-only';

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

// Mission 6 (validation receipts -> accuracy badge integration) — plain
// basename extraction with no `node:path` import (this file bundles into the
// renderer). Handles both `/` and `\` separators since installed executable
// paths come from Windows discovery. Real evidence only: this is only ever
// applied to an actual discovered `executablePath`/`canonicalExecutablePath`
// string, never a title/display name.
function basenameOfExecutablePath(executablePath: string): string {
  const normalized = executablePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? executablePath;
}

function buildInstalledExecutableNameMap(
  games: Array<{ catalogGameId?: string; canonicalExecutablePath?: string; executablePath?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const game of games) {
    if (!game.catalogGameId) continue;
    const executablePath = game.canonicalExecutablePath ?? game.executablePath;
    if (!executablePath) continue;
    map.set(game.catalogGameId, basenameOfExecutablePath(executablePath));
  }
  return map;
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

/**
 * Core Product Completion audit, Mission 1 — normalizes every catalog
 * entry's displayName at the renderer's own IPC-receipt boundary (not the
 * database, not the IPC payload itself — the local React state copy). One
 * normalization point here means every downstream consumer (CatalogCard's
 * title/alt/aria-label, section/search grouping, toast message strings)
 * automatically sees safe text without needing its own sanitization call.
 */
function normalizeCatalogEntryDisplay(entry: TrainerCatalogEntry): TrainerCatalogEntry {
  const safeDisplayName = toSafeDisplayText(entry.displayName);
  return safeDisplayName === entry.displayName ? entry : { ...entry, displayName: safeDisplayName };
}

/** Prefix marking a synthetic (non-catalog) LibraryGameEvidence/TrainerCatalogEntry built from an unmatched local install — never a real catalogGameId, so IPC calls (favorite/support) must never receive one. */
const LOCAL_INSTALL_SYNTHETIC_ID_PREFIX = 'local-install:';

function isSyntheticLocalInstallId(catalogGameId: string): boolean {
  return catalogGameId.startsWith(LOCAL_INSTALL_SYNTHETIC_ID_PREFIX);
}

function basenameFromPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

/**
 * Certification-pass fix: install-discovery can detect a real local install
 * that never matched any catalog entry (`catalogGameId` absent). Before this
 * fix, such a game was invisible everywhere in Trainer Library — dropped
 * silently rather than routed to the frozen hierarchy's own "Missing / Not
 * Yet Supported" section (library-sections.ts's `missing_unsupported`,
 * reached via `isFromLinkedLibrary: true` with `isKnownToCatalog: false`).
 * These synthetic entries carry no real catalog identity — Favorite/Request
 * Support are intentionally not wired for them (see renderLibraryCard).
 */
function buildUnmatchedInstalledLibraryData(
  games: Array<{ installIdentity: string; catalogGameId?: string; displayName?: string; installPath: string; executablePath?: string }>,
): { evidence: LibraryGameEvidence[]; entries: Map<string, TrainerCatalogEntry> } {
  const evidence: LibraryGameEvidence[] = [];
  const entries = new Map<string, TrainerCatalogEntry>();
  for (const game of games) {
    if (game.catalogGameId) continue; // catalog-matched installs already flow through the normal 'installed' path
    const syntheticId = `${LOCAL_INSTALL_SYNTHETIC_ID_PREFIX}${game.installIdentity}`;
    const displayName = toSafeDisplayText(game.displayName?.trim() || '') || basenameFromPath(game.installPath) || 'Unrecognized local install';
    evidence.push({
      canonicalGameId: syntheticId,
      displayName,
      isInstalled: false,
      ownedConfirmed: false,
      isKnownToCatalog: false,
      hasTrainerSupport: false,
      isFromLinkedLibrary: true,
    });
    entries.set(syntheticId, {
      catalogGameId: syntheticId,
      displayName,
      executables: game.executablePath ? [basenameFromPath(game.executablePath)] : [],
      categories: [],
      verificationStatus: 'unverified',
      sources: [],
      hasModPack: false,
      cheatCount: 0,
      searchableText: displayName.toLowerCase(),
    });
  }
  return { evidence, entries };
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

/**
 * Mission 10 — only these 5 of the 7 TrainerAccuracyState values are worth a
 * badge; INCOMPATIBLE/NONE are intentionally excluded here to avoid clutter
 * (mirroring the existing statusRow pattern where "community"/"metadata-only"
 * verification statuses get no badge — INCOMPATIBLE already surfaces via the
 * existing stale/quarantine badge path where relevant, and NONE means there
 * is nothing to say about accuracy at all).
 */
const TRAINER_ACCURACY_BADGE_LABELS: Partial<Record<TrainerAccuracyState, string>> = {
  LOCALLY_VERIFIED: 'Locally Verified',
  EXACT_VERSION_MATCH: 'Exact Match',
  STRONG_MATCH: 'Strong Match',
  VERSION_UNKNOWN: 'Version Unknown',
  NEEDS_REVERIFY: 'Needs Reverify',
};

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
  favorite,
  onToggleFavorite,
  supportRequestStatus,
  onRequestSupport,
  trainerAccuracy,
  viewMode = 'grid',
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
  favorite?: boolean;
  onToggleFavorite?: (entry: TrainerCatalogEntry) => void;
  /** Mission 6/7 — undefined means "has trainer support, no request UI needed". */
  supportRequestStatus?: 'none' | 'requested' | 'acknowledged' | 'in_progress';
  onRequestSupport?: (entry: TrainerCatalogEntry) => void;
  /** Mission 10 — real TrainerAccuracyState from Phase 1's computeTrainerAccuracy; undefined means "not computed for this card". */
  trainerAccuracy?: TrainerAccuracyState;
  /** Owner-directed grid/list toggle (getLibraryViewMode/setLibraryViewMode) — purely a layout hint via data-view-mode; no behavior changes. */
  viewMode?: 'grid' | 'list';
}) {
  // Mission 5 fix: .coverWrap (TrainerLibraryPage.module.css) is a fixed-
  // height, full-width LANDSCAPE banner strip (96px tall) in both grid and
  // list view — it was previously fed resolveCatalogCoverUrl's PORTRAIT
  // library-capsule art (2:3), which object-fit: cover then crops hard into
  // a thin horizontal sliver. resolveCatalogHeaderUrl returns the actual
  // landscape header art (Steam header.jpg, ~460x215) this slot's aspect
  // ratio calls for — same precedence hierarchy (cache -> curated ->
  // trusted CDN), just the correct artwork kind for a landscape slot.
  const coverUrl = resolveCatalogHeaderUrl(entry);
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
  const accuracyBadgeLabel = trainerAccuracy ? TRAINER_ACCURACY_BADGE_LABELS[trainerAccuracy] : undefined;

  return (
    <article className={styles.card} data-view-mode={viewMode}>
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
        <div className={styles.titleRow}>
          <h2 className={styles.title} title={entry.displayName}>
            {entry.displayName}
          </h2>
          {onToggleFavorite && (
            <button
              type="button"
              className={styles.favoriteBtn}
              aria-pressed={Boolean(favorite)}
              aria-label={favorite ? `Remove ${entry.displayName} from favorites` : `Add ${entry.displayName} to favorites`}
              title={favorite ? 'Favorited' : 'Add to favorites'}
              onClick={() => onToggleFavorite(entry)}
            >
              {favorite ? '★' : '☆'}
            </button>
          )}
        </div>
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
          {/* Mission 10 — a second small badge slot, distinct from the
              catalog-level tier/staleness badge above (that one is about the
              CATALOG entry's own verification trust; this one is about THIS
              user's personal trainer/game accuracy evidence — they can
              legitimately both be shown at once without being redundant). */}
          {accuracyBadgeLabel && (
            <span
              className={styles.tierBadge}
              data-accuracy={trainerAccuracy}
              title="Trainer accuracy for your installed copy of this game, based on local evidence."
            >
              {accuracyBadgeLabel}
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
          {!entry.hasModPack && onRequestSupport && (
            <div className={styles.supportRequestRow}>
              <span className={styles.notYetSupportedLabel}>Not Yet Supported</span>
              {supportRequestStatus && supportRequestStatus !== 'none' ? (
                <span className={styles.supportRequestedLabel}>Support Requested ✓</span>
              ) : (
                <button type="button" className={styles.secondaryBtn} onClick={() => onRequestSupport(entry)}>
                  Request Support
                </button>
              )}
            </div>
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
  // Mission 3 (Personal Library Completion — Final Closure Pass): the full
  // ~6,800-entry catalog fetch (fetchAllCandidatePages) still runs in full —
  // completeness is never sacrificed — but it no longer has to finish before
  // Running/Installed/Owned/Favorites become visible. `catalogFullyLoaded`
  // only gates the parts of the UI that genuinely need the complete set
  // (the flat "All Games" browse view, and the true "no catalog data at
  // all yet" empty state) — never used to fabricate ownership/availability,
  // which always come from real evidence at every point of the load.
  const [catalogFullyLoaded, setCatalogFullyLoaded] = useState(false);
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
  // Mission 6 (validation receipts -> accuracy badge integration gap) — real,
  // never-fabricated evidence for the receipt-currency check: the basename of
  // the actually-discovered installed executable (install-discovery's own
  // evidence, same source as installedIds/installedPlatformsByCatalogGameId
  // above), and the latest validation receipt per catalog game id fetched
  // from the new read-only get-validation-receipts-for-games IPC.
  const [installedExecutableNameByCatalogGameId, setInstalledExecutableNameByCatalogGameId] = useState<Map<string, string>>(new Map());
  const [receiptsByGameId, setReceiptsByGameId] = useState<Record<string, ValidationReceipt | null>>({});
  const [unmatchedInstalledGames, setUnmatchedInstalledGames] = useState<
    Array<{ installIdentity: string; catalogGameId?: string; displayName?: string; installPath: string; executablePath?: string }>
  >([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [healthMap, setHealthMap] = useState<Record<string, { status: string }>>({});
  const [runningOnly, setRunningOnly] = useState(false);
  const [needsReverifyOnly, setNeedsReverifyOnly] = useState(false);
  // Owner-directed redesign — real quick-view tabs (Running/Installed/Owned/
  // Favorites/All Games) and a real Sort control replace the old hardcoded
  // 'all' viewMode. These are display-level: the underlying fetch always
  // pulls the complete personal library (fetchAllCandidatePages, unchanged)
  // — tabs/sort only narrow/reorder what's already loaded, they never
  // reintroduce the old retired Popular/AllGames fetch-mode toggle.
  const [quickTab, setQuickTab] = useState<TrainerLibraryQuickTab>('all');
  const [sortOption, setSortOption] = useState<TrainerLibrarySortOption>(DEFAULT_TRAINER_LIBRARY_SORT_OPTION);
  const [popularityMap, setPopularityMap] = useState<Map<string, TrainerCatalogPopularityEvidence>>(new Map());
  const [allTimePopularityMap, setAllTimePopularityMap] = useState<Map<string, number>>(new Map());
  const [catalogFilterUniverse, setCatalogFilterUniverse] = useState<TrainerCatalogEntry[] | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [flatAZView, setFlatAZView] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [supportRequestStatuses, setSupportRequestStatuses] = useState<Record<string, string>>({});
  // Session-only persistence for collapsed-section expand state (Mission 4)
  // — mirrors the existing sessionStorage-based filter persistence pattern
  // already used elsewhere on this page, not a new persistence mechanism.
  const [sectionExpandedOverrides, setSectionExpandedOverrides] = useState<Partial<Record<LibrarySectionKey, boolean>>>(
    () => {
      try {
        const raw = sessionStorage.getItem('trainerLibrary.sectionExpanded');
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    },
  );
  // Mission 5 REVERSAL — the section view now virtualizes (SectionVirtualGrid)
  // instead of chunked "Show more" rendering, so there is no per-section
  // visible-count state to track anymore; every section renders its full,
  // filtered/sorted game list straight into a windowed grid.
  // Owner-directed addition: real grid/list view mode, persisted via the
  // `get-settings`/`set-setting` IPC channel (electron/main.ts,
  // src/core/settings/index.ts), read once at mount the same way
  // ViewModeToggle itself does. This page is renderer-side, so it must go
  // through window.electronAPI rather than importing src/core/settings
  // directly (that module is main-process-only and crashes the renderer
  // bundle if imported — it transitively pulls in better-sqlite3 via
  // src/core/database). ViewModeToggle owns writes to this setting; this
  // page only mirrors the value locally via onChange.
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>('grid');

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getSettings().then((settings: { libraryViewMode?: unknown }) => {
      if (!cancelled && (settings?.libraryViewMode === 'grid' || settings?.libraryViewMode === 'list')) {
        setLibraryViewMode(settings.libraryViewMode);
      }
    }).catch(() => {
      // Fall back to the 'grid' default already set above.
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
        const normalized = result.entries.map(normalizeCatalogEntryDisplay);
        setEntries((prev) => (append ? [...prev, ...normalized] : normalized));
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
    // Mission 3: this always runs to completion regardless of what the fast
    // path above already rendered — completeness is never traded for speed,
    // only the "is the page blocked waiting for it" behavior changed. Reset
    // to false at the start of every call (including refetches on filter
    // change) so the "All Games" flat view's gate stays accurate.
    setCatalogFullyLoaded(false);
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
        all.push(...result.entries.map(normalizeCatalogEntryDisplay));
        expectedTotal = result.total ?? all.length;
        pageOffset += POPULAR_TRAINER_LIMIT;
      }
      // The complete candidate set always wins over whatever the fast path
      // rendered first — this is what keeps section completeness identical
      // to before the fast path existed.
      setEntries(all);
      // Every raw DB page has now been visited; report the actual eligible/search-matched
      // candidate count rather than the store's pre-eligibility SQL count.
      setTotal(all.length);
      setOffset(all.length);
      setCatalogFullyLoaded(true);
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
    // Certification-pass fix: the frozen section hierarchy (Mission 2) must
    // organize the COMPLETE personal library, not just the first PAGE_SIZE
    // (120) rows of a single catalog page. Before this fix, `load()` only
    // took the fetch-everything path when a derived filter (availability/
    // catalog/launcher/mode) was active — with no filters, the section view
    // silently built every section (most visibly "All Other Games") from
    // only the first page's candidates, undercounting and dropping games
    // that never scrolled into view (the section-hierarchy render path has
    // no onEndReached/infinite-scroll of its own, unlike the flat A-Z view).
    // The fetch pipeline always pulls the complete candidate set (the retired
    // Popular projection never runs here) — the quick-view tabs and sort
    // control added back on top of this are display-level narrowing/
    // reordering only, never a different fetch mode.
    await fetchAllCandidatePages(searchQuery, tier, genres);
  }, [fetchAllCandidatePages, query, tierFilter, genreFilters]);

  useEffect(() => {
    void load(query, tierFilter, genreFilters);
  }, [tierFilter, genreFilters, availabilityFilters, catalogFilters, launcherFilters, modeFilters]); // eslint-disable-line react-hooks/exhaustive-deps -- text search uses submit

  useEffect(() => {
    const api = window.electronAPI;
    if (api?.listFavorites) {
      void api.listFavorites().then((result) => {
        if (result.success && result.favoriteIds) setFavoriteIds(new Set(result.favoriteIds));
      });
    }
    if (api?.listSupportRequests) {
      void api.listSupportRequests().then((result) => {
        if (result.success && result.requests) {
          setSupportRequestStatuses(
            Object.fromEntries(result.requests.map((r) => [r.canonicalGameId, r.status.toLowerCase()])),
          );
        }
      });
    }
  }, []);

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
        all.push(...result.entries.map(normalizeCatalogEntryDisplay));
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
        setInstalledExecutableNameByCatalogGameId(buildInstalledExecutableNameMap(result.games));
        setUnmatchedInstalledGames(result.games.filter((g) => !g.catalogGameId));
      }
    });
    void api.trainerHealthList?.().then((result) => {
      if (result.success && result.map) setHealthMap(result.map);
    });
  }, []);

  // Mission 6 (validation receipts -> accuracy badge integration gap) — real
  // receipt evidence for exactly the catalog games currently loaded into the
  // library (`entries`, the same candidate set the accuracy badge/sort
  // already renders from), never a bulk "every receipt in the database"
  // fetch. Re-fires whenever the loaded candidate set changes (search,
  // filters, sync) so a freshly-matched game always gets a real lookup
  // instead of a stale/empty one.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getValidationReceiptsForGames || entries.length === 0) return;
    let cancelled = false;
    const gameIds = Array.from(new Set(entries.map((entry) => entry.catalogGameId)));
    void api.getValidationReceiptsForGames(gameIds).then((result) => {
      if (!cancelled && result.success && result.receipts) {
        setReceiptsByGameId(result.receipts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entries]);

  // Mission 3 (Personal Library Completion — Final Closure Pass) — My-Games
  // fast path. Running/Installed/Owned/Favorites must not wait on the full
  // ~6,800-entry catalog fetch (fetchAllCandidatePages, still running in
  // full below — completeness is never traded away). This effect only reads
  // already-fast local sources (installDiscoveryList, listFavorites,
  // trainerCatalogListOwned — all narrow, indexed, small-result queries) and
  // then resolves catalog METADATA (title/cover/categories/etc.) for just
  // that small id set via the existing single-entry trainerCatalogGet, never
  // a new bulk endpoint and never a full scan. It only ever ADOPTS this as a
  // first-paint shortcut when nothing has rendered yet (`prev.length === 0`)
  // — it can never clobber a more complete fetch that already landed, and
  // the background fetchAllCandidatePages below always runs to completion
  // and unconditionally replaces `entries` with the real complete set, so
  // section completeness ends up identical to before, just visible sooner.
  // No ownership is fabricated here: entries with unknown ownedConfirmed
  // still resolve to `owned: 'unknown'` exactly as project­PersonalLibraryGame
  // guarantees elsewhere.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.trainerCatalogGet) return;
    let cancelled = false;
    void (async () => {
      const [installResult, favoritesResult, ownedResult] = await Promise.all([
        api.installDiscoveryList?.() ?? Promise.resolve(undefined),
        api.listFavorites?.() ?? Promise.resolve(undefined),
        api.trainerCatalogListOwned?.() ?? Promise.resolve(undefined),
      ]);
      if (cancelled) return;

      const fastIds = new Set<string>();
      if (installResult?.success && installResult.catalogGameIds) {
        for (const id of installResult.catalogGameIds) fastIds.add(id);
      }
      if (favoritesResult?.success && favoritesResult.favoriteIds) {
        for (const id of favoritesResult.favoriteIds) fastIds.add(id);
      }
      if (ownedResult?.success && ownedResult.ownedCatalogGameIds) {
        for (const id of ownedResult.ownedCatalogGameIds) fastIds.add(id);
      }
      if (fastIds.size === 0) return;

      const fetched = await Promise.all(
        [...fastIds].map(async (catalogGameId) => {
          const result = await api.trainerCatalogGet!({ catalogGameId });
          return result.success && result.entry ? normalizeCatalogEntryDisplay(result.entry as TrainerCatalogEntry) : null;
        }),
      );
      if (cancelled) return;

      const fastEntries = fetched.filter((entry): entry is TrainerCatalogEntry => Boolean(entry));
      if (fastEntries.length === 0) return;

      setEntries((prev) => (prev.length === 0 ? fastEntries : prev));
      setTotal((prev) => (prev === 0 ? fastEntries.length : prev));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onCatalogProcessDetected?.((payload) => {
      if (!payload) return;
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
      setUnmatchedInstalledGames(list.games.filter((g) => !g.catalogGameId));
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

  const handleToggleFavorite = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    const currentlyFavorite = favoriteIds.has(entry.catalogGameId);
    // Optimistic update — the star should feel instant; roll back on failure.
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (currentlyFavorite) next.delete(entry.catalogGameId);
      else next.add(entry.catalogGameId);
      return next;
    });
    const result = currentlyFavorite
      ? await api?.unfavoriteGame?.({ canonicalGameId: entry.catalogGameId })
      : await api?.favoriteGame?.({ canonicalGameId: entry.catalogGameId });
    if (!result?.success) {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (currentlyFavorite) next.add(entry.catalogGameId);
        else next.delete(entry.catalogGameId);
        return next;
      });
      setMessage(result?.error ?? 'Failed to update favorite.');
    }
  };

  const handleRequestSupport = async (entry: TrainerCatalogEntry) => {
    const api = window.electronAPI;
    if (!api?.requestGameSupport) return;
    // Optimistic + server is itself dedup-safe (Mission 16) — a repeated
    // click here is a harmless no-op on the backend, never a duplicate row.
    setSupportRequestStatuses((prev) => ({ ...prev, [entry.catalogGameId]: 'requested' }));
    const result = await api.requestGameSupport({
      canonicalGameId: entry.catalogGameId,
      gameTitle: entry.displayName,
      platforms: [...(installedPlatformsByCatalogGameId.get(entry.catalogGameId) ?? [])],
    });
    if (result.success && result.request) {
      setSupportRequestStatuses((prev) => ({ ...prev, [entry.catalogGameId]: result.request!.status.toLowerCase() }));
    } else {
      setMessage(result.error ?? 'Failed to submit support request.');
    }
  };

  const toggleSectionExpanded = (sectionKey: LibrarySectionKey) => {
    setSectionExpandedOverrides((prev) => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      try {
        sessionStorage.setItem('trainerLibrary.sectionExpanded', JSON.stringify(next));
      } catch {
        /* ignore — session-only convenience, not required to persist */
      }
      return next;
    });
  };

  // Mission 6 (validation receipts -> accuracy badge integration gap) —
  // real receipt evidence for one catalog entry, built from the latest
  // receipt fetched via get-validation-receipts-for-games (receiptsByGameId)
  // and real "current" comparable fields:
  //  - executableName: the actually-discovered installed executable's
  //    basename (installedExecutableNameByCatalogGameId), falling back to
  //    the receipt's own name only when no live install evidence exists at
  //    all — never a title/display-name guess.
  //  - trainerSource: the catalog entry's real ModPackSource provider from
  //    entry.sources (e.g. 'bundled'/'community'), never fabricated.
  //  - executableVersion/executableHash: no live version/hash evidence
  //    pipeline exists in this renderer yet, so these are honestly left
  //    `undefined` rather than guessed — per needsReverify's own rule,
  //    missing evidence on either side is never treated as a mismatch.
  // This function never reimplements the reverify decision itself —
  // deriveReceiptEvidence delegates that entirely to the EXISTING
  // needsReverify in trainer-catalog/trainer-accuracy.ts.
  const getReceiptEvidenceForEntry = (entry: TrainerCatalogEntry) => {
    const latestReceipt = receiptsByGameId[entry.catalogGameId] ?? null;
    const installedExecutableName = installedExecutableNameByCatalogGameId.get(entry.catalogGameId);
    return deriveReceiptEvidence(latestReceipt, {
      executableName: installedExecutableName ?? latestReceipt?.executableName ?? entry.executables[0] ?? '',
      executableVersion: undefined,
      executableHash: undefined,
      trainerSource: entry.sources[0]?.provider ?? latestReceipt?.trainerSource ?? 'unknown',
      trainerVersionHint: undefined,
    });
  };

  const renderLibraryCard = (g: LibraryGameEvidence) => {
    const entry = entryByGameId.get(g.canonicalGameId);
    if (!entry) return null;
    // Synthetic unmatched-local-install entries (see
    // buildUnmatchedInstalledLibraryData) have no real catalog identity —
    // Favorite/Request Support IPC would correctly reject them
    // (personal-library-ipc.ts's requireKnownCatalogGameId), so the controls
    // are simply not offered rather than surfacing a confusing IPC error.
    const isSynthetic = isSyntheticLocalInstallId(entry.catalogGameId);
    const isInstalledForAccuracy = installedIds.has(entry.catalogGameId);
    // Mission 6 — real receipt evidence (see getReceiptEvidenceForEntry
    // above) replaces the old hardcoded `hasValidationReceipt: false`.
    // `strongMatchEvidence` still uses real, non-title evidence: install-
    // discovery's own executable/canonical-identity match (installedIds),
    // never a title-text match.
    const trainerAccuracy = computeTrainerAccuracy({
      hasTrainer: entry.hasModPack,
      ...getReceiptEvidenceForEntry(entry),
      exactVersionEvidence: false,
      exactVersionMismatch: false,
      strongMatchEvidence: isInstalledForAccuracy,
    });
    return (
      <CatalogCard
        key={g.canonicalGameId}
        entry={entry}
        trust={trustMeta[entry.catalogGameId]}
        installed={isInstalledForAccuracy}
        running={runningIds.has(entry.catalogGameId)}
        healthStatus={healthMap[entry.catalogGameId]?.status}
        trainerAccuracy={trainerAccuracy}
        viewMode={libraryViewMode}
        onLaunch={handleLaunch}
        onExport={handleExportYaml}
        onThumbUp={handleThumbUp}
        onRequestVerification={handleRequestVerification}
        onNotify={handleNotifyWhenVerified}
        onPublish={handlePublish}
        onToggleOwned={handleToggleOwned}
        favorite={isSynthetic ? undefined : favoriteIds.has(entry.catalogGameId)}
        onToggleFavorite={isSynthetic ? undefined : handleToggleFavorite}
        supportRequestStatus={
          isSynthetic || entry.hasModPack ? undefined : ((supportRequestStatuses[entry.catalogGameId] as never) ?? 'none')
        }
        onRequestSupport={isSynthetic ? undefined : handleRequestSupport}
      />
    );
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

  // Mission 2/7 — the frozen section hierarchy replaces sort-mode selection.
  // isInstalled/ownedConfirmed/hasTrainerSupport all come from evidence
  // already tracked on TrainerCatalogEntry / installedIds — nothing here is
  // fabricated, and an owned-but-unsupported game is never dropped (Mission 7).
  const catalogLibraryEvidence: LibraryGameEvidence[] = filteredEntries.map((entry) => ({
    canonicalGameId: entry.catalogGameId,
    displayName: entry.displayName,
    isInstalled: installedIds.has(entry.catalogGameId),
    ownedConfirmed: entry.ownedConfirmed === true,
    isKnownToCatalog: true,
    hasTrainerSupport: entry.hasModPack === true,
    isFromLinkedLibrary: installedIds.has(entry.catalogGameId),
    isRunning: runningIds.has(entry.catalogGameId),
  }));

  // Real local installs that never matched a catalog entry — surfaced into
  // library-sections.ts's 'missing_unsupported' section rather than silently
  // dropped (see buildUnmatchedInstalledLibraryData's doc comment). These
  // never came from trainerCatalogSearch's backend query, so the same
  // free-text query the catalog path already applied server-side is applied
  // here client-side, keeping Mission 4's "search covers every section"
  // requirement true for this section too.
  const { evidence: unmatchedEvidence, entries: unmatchedEntryMap } = buildUnmatchedInstalledLibraryData(unmatchedInstalledGames);
  const normalizedQuery = query.trim().toLowerCase();
  const queryFilteredUnmatchedEvidence = normalizedQuery
    ? unmatchedEvidence.filter((g) => g.displayName.toLowerCase().includes(normalizedQuery))
    : unmatchedEvidence;

  const libraryEvidence: LibraryGameEvidence[] = [...catalogLibraryEvidence, ...queryFilteredUnmatchedEvidence];

  // Quick-view tabs (Running/Installed/Owned/All Games) — a display-level
  // narrowing of the same evidence the section hierarchy already computes
  // from, applied before organizeLibrary so every section a tab produces
  // still gets assigned/sorted by the frozen, untouched assignLibrarySection
  // rules. Favorites stays its own independent toggle (see
  // TrainerLibraryQuickTabs's header comment) and is applied afterward,
  // exactly as it always was.
  const quickTabFilteredEvidence = libraryEvidence.filter((g) => {
    if (quickTab === 'running') return g.isRunning === true;
    if (quickTab === 'installed') return g.isInstalled;
    if (quickTab === 'owned') return g.ownedConfirmed;
    return true;
  });

  const favoriteFilteredEvidence = showFavoritesOnly
    ? quickTabFilteredEvidence.filter((g) => favoriteIds.has(g.canonicalGameId))
    : quickTabFilteredEvidence;

  // Certification-pass fix: a collapsed-by-default section (e.g. "All Other
  // Games", where most catalog entries land) must not hide a game the user
  // explicitly favorited — the whole point of switching to the Favorites
  // view is to see them. Search already overrides collapse (Mission 4);
  // Favorites-only needs the identical override for the identical reason.
  const isSearchActive = query.trim().length > 0;
  const forceSectionsExpanded = isSearchActive || showFavoritesOnly;
  const organizedLibrary = organizeLibrary(favoriteFilteredEvidence);
  const flatSortedEntries = flatAZView ? sortLibraryAZ(favoriteFilteredEvidence) : null;
  const entryByGameId = new Map<string, TrainerCatalogEntry>([
    ...filteredEntries.map((e): [string, TrainerCatalogEntry] => [e.catalogGameId, e]),
    ...unmatchedEntryMap,
  ]);

  // Owner-directed Sort control — scoped to the flat/All-Games browse view
  // only (see trainer-library-sort-options.ts's header comment). This is a
  // second pass ON TOP OF the frozen `flatSortedEntries` (A-Z) baseline
  // above, which stays byte-for-byte the regression-locked expression
  // tests/trainer-library-card-states.test.tsx pins — it is not replaced,
  // just further reordered here for actual display when a non-A-Z sort is chosen.
  // Mission 12 — the same real, non-title evidence the accuracy badge (see
  // renderLibraryCard) uses, built once per render for every filtered entry
  // so "Trainer quality" sort can rank by the actual TrainerAccuracyState
  // instead of the pre-Phase-1 verificationStatus/hasModPack/cheatCount
  // placeholder heuristic.
  const trainerAccuracyByCatalogGameId = new Map<string, TrainerAccuracyState>(
    filteredEntries.map((entry) => [
      entry.catalogGameId,
      computeTrainerAccuracy({
        hasTrainer: entry.hasModPack,
        ...getReceiptEvidenceForEntry(entry),
        exactVersionEvidence: false,
        exactVersionMismatch: false,
        strongMatchEvidence: installedIds.has(entry.catalogGameId),
      }),
    ]),
  );
  const sortContext: AllGamesSortContext & {
    trainerAccuracyByCatalogGameId: Map<string, TrainerAccuracyState>;
    runningCatalogGameIds: Set<string>;
    favoriteCatalogGameIds: Set<string>;
  } = {
    installedCatalogGameIds: installedIds,
    popularityByCatalogGameId: popularityMap,
    allTimePopularityByCatalogGameId: allTimePopularityMap,
    trainerAccuracyByCatalogGameId,
    // Mission 2 (Personal Library Completion — Final Closure Pass): real
    // running/favorite id sets the page already tracks, wired through so
    // 'Recommended' can route via personal-priority-comparator.ts instead of
    // the older installed/popularity-only ranking model.
    runningCatalogGameIds: runningIds,
    favoriteCatalogGameIds: favoriteIds,
  };
  const sortedFlatEntries = flatSortedEntries && sortOption !== 'a-z'
    ? (() => {
        const flatCatalogEntries = flatSortedEntries
          .map((g) => entryByGameId.get(g.canonicalGameId))
          .filter((e): e is TrainerCatalogEntry => Boolean(e));
        const sortedCatalogEntries = sortTrainerLibraryFlatEntries(flatCatalogEntries, sortOption, sortContext);
        const evidenceById = new Map(flatSortedEntries.map((g) => [g.canonicalGameId, g]));
        return sortedCatalogEntries
          .map((e) => evidenceById.get(e.catalogGameId))
          .filter((g): g is LibraryGameEvidence => Boolean(g));
      })()
    : flatSortedEntries;

  // "Your Games" — real counts derived from the same section evidence
  // organizeLibrary already computed (never hardcoded): everything that
  // isn't a bare catalog browse entry — Installed plus both Owned buckets.
  const installedCount = organizedLibrary.sections.installed.length;
  const ownedCount =
    organizedLibrary.sections.owned_supported.length + organizedLibrary.sections.owned_unsupported.length;
  const yourGamesCount = installedCount + ownedCount;

  const activeFilterCount =
    availabilityFilters.length +
    catalogFilters.length +
    launcherFilters.length +
    modeFilters.length +
    genreFilters.length +
    (runningOnly ? 1 : 0) +
    (needsReverifyOnly ? 1 : 0);

  const activeFilterSummary =
    [
      showFavoritesOnly ? 'Favorites' : null,
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
            <ViewModeToggle onChange={setLibraryViewMode} />
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

      {/* Owner-directed redesign: this panel used to render open by default,
          dominating the fold above the actual games. All functionality/
          handlers/state below are unchanged — only the default visibility
          moved to a collapsed <details> disclosure. */}
      <details className={styles.collapsiblePanel}>
        <summary className={styles.collapsiblePanelSummary} id="community-hub-heading">
          Community Hub Sync ▾
        </summary>
        <div className={styles.collapsiblePanelBody}>
          <div className={styles.hubPanelHeader}>
            <h2>Solith Definition Hub</h2>
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
        </div>
      </details>

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

      {/* Owner-directed redesign: collapsed by default (was always-open).
          All functionality/handlers/state below are unchanged. */}
      <details id="trainer-library-discovery-preview" className={styles.collapsiblePanel}>
        <summary className={styles.collapsiblePanelSummary}>Scan for Installed Games ▾</summary>
        <div className={styles.collapsiblePanelBody}>
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
        </div>
      </details>

      {/* Owner-directed redesign — compact top area: search + one Filters
          popover + Sort replace the old always-visible 7 filter-chip-rows.
          Filtering stays instant/live, exactly as before — there is no
          separate Apply step. */}
      <div className={styles.topControlsRow}>
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
        <TrainerLibraryFiltersPopover
          availabilityFilters={availabilityFilters}
          onToggleAvailability={toggleAvailabilityFilter}
          catalogFilters={catalogFilters}
          onToggleCatalog={toggleCatalogFilter}
          launcherFilters={launcherFilters}
          onToggleLauncher={toggleLauncherFilter}
          modeFilters={modeFilters}
          onToggleMode={toggleModeFilter}
          genreFilters={genreFilters}
          genreOptions={ROADMAP_GENRE_FILTERS}
          onToggleGenre={toggleGenre}
          runningOnly={runningOnly}
          onToggleRunningOnly={() => setRunningOnly((v) => !v)}
          needsReverifyOnly={needsReverifyOnly}
          onToggleNeedsReverifyOnly={() => setNeedsReverifyOnly((v) => !v)}
          activeCount={activeFilterCount}
          onClearAll={resetLibraryFilters}
        />
        <TrainerLibrarySortMenu value={sortOption} onChange={setSortOption} />
        <button
          type="button"
          className={flatAZView ? styles.filterActive : styles.filterBtn}
          onClick={() => setFlatAZView((v) => !v)}
          aria-pressed={flatAZView}
          title="Sort applies to this flat view; the 5-section hierarchy always stays A-Z within each section."
        >
          Flat list
        </button>
      </div>

      <TrainerLibraryQuickTabs
        activeTab={quickTab}
        onSelectTab={setQuickTab}
        favoritesActive={showFavoritesOnly}
        onToggleFavorites={() => setShowFavoritesOnly((v) => !v)}
      />

      <TrainerLibraryActiveFilterChips
        availabilityFilters={availabilityFilters}
        onToggleAvailability={toggleAvailabilityFilter}
        catalogFilters={catalogFilters}
        onToggleCatalog={toggleCatalogFilter}
        launcherFilters={launcherFilters}
        onToggleLauncher={toggleLauncherFilter}
        modeFilters={modeFilters}
        onToggleMode={toggleModeFilter}
        genreFilters={genreFilters}
        onToggleGenre={toggleGenre}
        runningOnly={runningOnly}
        onToggleRunningOnly={() => setRunningOnly((v) => !v)}
        needsReverifyOnly={needsReverifyOnly}
        onToggleNeedsReverifyOnly={() => setNeedsReverifyOnly((v) => !v)}
        onClearAll={resetLibraryFilters}
      />

      <div className={styles.resultSummaryRow} role="status" aria-live="polite">
        <span className={styles.resultSummaryCounts}>
          Your Games — {yourGamesCount.toLocaleString()} · {installedCount.toLocaleString()} installed ·{' '}
          {ownedCount.toLocaleString()} owned
        </span>
        {quickTab !== 'all' && (
          <button type="button" className={styles.browseAllLink} onClick={() => setQuickTab('all')}>
            Browse all {total.toLocaleString()} supported games →
          </button>
        )}
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
      {/*
        Mission 3 (Personal Library Completion — Final Closure Pass): the
        blocking "Loading catalog…" message now only shows when there is
        LITERALLY nothing to render yet — as soon as the fast path (or the
        full fetch) produces any evidence, `favoriteFilteredEvidence` is
        non-empty and the real content renders immediately, independent of
        `loading`. `loading` alone no longer gates rendering.
      */}
      {loading && favoriteFilteredEvidence.length === 0 && <p className={styles.loading}>Loading catalog…</p>}
      {!catalogFullyLoaded && favoriteFilteredEvidence.length > 0 && (
        <p className={styles.loading} role="status" aria-live="polite">
          Loading the full catalog in the background… ({entries.length.toLocaleString()} of{' '}
          {total > 0 ? total.toLocaleString() : '…'} loaded)
        </p>
      )}

      {!loading && favoriteFilteredEvidence.length === 0 && (
        <p className={styles.loading}>No games match your filters — try clearing genre chips or search.</p>
      )}

      {favoriteFilteredEvidence.length > 0 && flatAZView && (
        <VirtualCatalogGrid
          className={styles.virtualScroll}
          gridClassName={styles.grid}
          backToTopClassName={styles.backToTopBtn}
          backToTopLabel="Back to top"
          items={sortedFlatEntries!}
          getKey={(g) => g.canonicalGameId}
          onEndReached={handleLoadMore}
          renderItem={(g) => renderLibraryCard(g)}
          forceSingleColumn={libraryViewMode === 'list'}
        />
      )}
      {/*
        Personal Library Completion — Final Closure Pass, Mission 5 REVERSAL
        (2026-09-10): the owner explicitly rejected the prior chunked "Show N
        more" rendering below in favor of real virtualization, matching the
        flat "All Games" view's own approach rather than inventing a second
        system. Every section (including "All Other Games", where most of
        the ~6,800-entry catalog lands) now renders through
        SectionVirtualGrid — only visible rows (+ overscan) ever mount,
        regardless of how many thousand games are in the section, and there
        is no nested `overflow: auto` scrollbox: SectionVirtualGrid tracks
        the page's own window scroll instead of owning its own scroll
        container (see SectionVirtualGrid.tsx and
        use-window-scroll-virtualization.ts for exactly how). Filtering/
        sorting is unaffected — `games` below is already the fully filtered/
        sorted array; SectionVirtualGrid only changes which of its members
        are MOUNTED, never which are INCLUDED.
      */}

      {favoriteFilteredEvidence.length > 0 && !flatAZView && (
        <>
          {LIBRARY_SECTION_ORDER.map((sectionKey) => {
            const games = organizedLibrary.sections[sectionKey];
            if (games.length === 0) return null;
            // Mission 4/11: an active search, or the Favorites-only view,
            // must surface a match inside a normally-collapsed section
            // without the user manually expanding it.
            const isCollapsed =
              LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has(sectionKey) && !forceSectionsExpanded
                ? !sectionExpandedOverrides[sectionKey]
                : false;
            return (
              <section key={sectionKey} className={styles.librarySection} aria-label={LIBRARY_SECTION_LABELS[sectionKey]}>
                <button
                  type="button"
                  className={styles.librarySectionHeader}
                  onClick={() => toggleSectionExpanded(sectionKey)}
                  aria-expanded={!isCollapsed}
                >
                  <span>{LIBRARY_SECTION_LABELS[sectionKey]} ({games.length.toLocaleString()})</span>
                  {LIBRARY_SECTIONS_COLLAPSED_BY_DEFAULT.has(sectionKey) && (
                    <span className={styles.librarySectionToggle}>{isCollapsed ? 'Expand ▾' : 'Collapse ▴'}</span>
                  )}
                </button>
                {!isCollapsed && (
                  <SectionVirtualGrid
                    gridClassName={styles.grid}
                    items={games}
                    getKey={(g) => g.canonicalGameId}
                    renderItem={(g) => renderLibraryCard(g)}
                    ariaLabel={`${LIBRARY_SECTION_LABELS[sectionKey]} results`}
                    forceSingleColumn={libraryViewMode === 'list'}
                  />
                )}
              </section>
            );
          })}
        </>
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

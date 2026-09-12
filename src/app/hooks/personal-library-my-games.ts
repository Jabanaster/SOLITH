/**
 * Pure "My Games" composition for usePersonalLibraryGames.ts (sidebar/Home
 * fast-path shelf). Split into its own file so the composition logic is
 * unit-testable in plain Node (`node --test`) without React or a DOM —
 * mirrors the existing pattern of src/core/personal-library/model.ts's
 * `projectPersonalLibraryGame` (pure projector, I/O gathered by the caller).
 *
 * Every input here comes from the SAME real, narrow, already-fast IPC calls
 * TrainerLibraryPage.tsx's own "My-Games fast path" effect already uses
 * (see its comment above the effect reading `installDiscoveryList`,
 * `listFavorites`, `trainerCatalogListOwned`, then `trainerCatalogGet` per
 * id) — never the ~6,800-row full catalog fetch. This module does not call
 * any IPC itself; usePersonalLibraryGames.ts gathers the raw results and
 * passes them in here.
 *
 * HONEST FIDELITY NOTES (read before trusting a field from this module):
 *   - `canonicalConfidence` IS real here (not reduced) — install-discovery
 *     records already carry `identityStatus` per installation, mapped with
 *     the same verified/backfilled/ambiguous->EXACT/HIGH/POSSIBLE scheme
 *     model.ts's `resolveCanonicalConfidence` uses. When a game has
 *     installations with different statuses across launchers, the most
 *     confident one wins (never fabricated upward beyond what any real
 *     installation reports).
 *   - `trainerAvailability` is real when a catalog entry was resolved via
 *     `trainerCatalogGet` (same verified/hasModPack/community rule as
 *     TrainerCatalogEntry->availability elsewhere); it stays 'NONE' for a
 *     game where no catalog entry could be resolved, which understates
 *     rather than fabricates.
 *   - `trainerAccuracy` is REAL when the caller supplies `receiptsByGameId`
 *     (Step 5, Home/My-Games — see usePersonalLibraryGames.ts): the SAME
 *     `getValidationReceiptsForGames` IPC and `deriveReceiptEvidence` bridge
 *     TrainerLibraryPage.tsx's own accuracy badge uses, bounded to the same
 *     narrow id set this fast path already resolves (never the full
 *     catalog). When `receiptsByGameId` is omitted (or has no entry for a
 *     given id), this honestly falls back to the reduced-fidelity floor: a
 *     game with any usable trainer is 'VERSION_UNKNOWN' — never
 *     'LOCALLY_VERIFIED' or 'EXACT_VERSION_MATCH' fabricated without
 *     evidence.
 *   - `versionEvidence` is always `[]` here: install-discovery's fast-path
 *     records carry no buildVersion field, and no validation receipt is
 *     looked up. This is an honest "no evidence gathered" empty array, not
 *     a fabricated one.
 *   - `ownershipEvidence`/`owned` only ever resolve to `true` or
 *     `'unknown'` — `listOwnedConfirmedCatalogGameIds()` (the real IPC this
 *     reads) only ever returns explicitly-confirmed-owned ids, never
 *     explicit declines, so `owned: false` is never produced by this path
 *     (matches `resolveOwnership`'s behavior for an unset signal).
 *   - a user-authored (ct-import) local trainer definition is NOT checked
 *     here, so `trainerAvailability` never resolves to `'LOCAL'` from this
 *     module even when one exists — another honest understatement, not a
 *     fabrication.
 */
import type { InstallPlatform } from '../../core/install-discovery/types.js';
import type {
  CanonicalConfidence,
  InstallEvidenceItem,
  OwnershipEvidenceItem,
  PersonalLibraryGame,
} from '../../core/personal-library/model.js';
import type { TrainerCatalogEntry } from '../../core/trainer-catalog/types.js';
import type { DiscoveryCatalogEntry } from '../../core/discovery-catalog/types.js';
import { resolveCatalogCoverUrl } from '../../core/trainer-catalog/cover-url.js';
import { computeTrainerAccuracy, type TrainerAccuracyState } from '../../core/trainer-catalog/trainer-accuracy.js';
import { deriveReceiptEvidence } from '../../core/validation-receipts/receipt-evidence.js';
import type { ValidationReceipt } from '../../core/validation-receipts/store.js';

const RECENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — matches model.ts's DEFAULT_RECENT_WINDOW_MS

/** One raw install-discovery record for a single launcher installation, as returned by installDiscoveryList(). */
export interface FastPathInstallRecord {
  catalogGameId?: string;
  catalogDisplayName?: string;
  identityStatus: 'verified' | 'backfilled' | 'ambiguous' | 'legacy';
  platform: InstallPlatform;
  installPath: string;
  executablePath?: string;
  detectedAt: string;
  lastSeenAt: string;
}

export interface MyGamesFastPathInput {
  installRecords: FastPathInstallRecord[];
  ownedCatalogGameIds: string[];
  favoriteCatalogGameIds: string[];
  /** Keyed by catalogGameId, for ids the caller successfully resolved via trainerCatalogGet(). Missing entries just mean "no catalog data resolved", not "no trainer". */
  catalogEntriesById: Record<string, TrainerCatalogEntry>;
  /**
   * Discovery Master Pass, Stage 1 fallback — for ids with NO legacy
   * trainer-catalog row (the normal case for a game a user favorited from
   * Discovery before ever getting a trainer for it), keyed the same way.
   * Only consulted when `catalogEntriesById` has no entry for that id, so a
   * game known to both catalogs always prefers the richer trainer-catalog
   * data. Without this, a Discovery-only favorite would render with its raw
   * internal id as its title and 'NONE' trainer availability regardless of
   * the real discovery_catalog_entries.trainerAvailable flag.
   */
  discoveryEntriesById?: Record<string, DiscoveryCatalogEntry>;
  /** Real running-game id from the same onCatalogProcessDetected signal the sidebar's Running shelf uses — never fabricated. */
  runningCatalogGameId?: string | null;
  nowIso: string;
  /**
   * Optional real validation-receipt evidence, keyed by catalogGameId, from
   * the SAME `getValidationReceiptsForGames` IPC TrainerLibraryPage.tsx's
   * accuracy badge uses — bounded to this fast path's own narrow id set.
   * When omitted (or missing an entry for a given id), that game's
   * trainerAccuracy honestly falls back to the 'VERSION_UNKNOWN' floor
   * described in the file header, rather than fabricating receipt evidence.
   */
  receiptsByGameId?: Record<string, ValidationReceipt | null>;
}

const IDENTITY_STATUS_RANK: Record<FastPathInstallRecord['identityStatus'], number> = {
  verified: 3,
  backfilled: 2,
  ambiguous: 1,
  legacy: 0,
};

function resolveCanonicalConfidenceFromInstalls(records: FastPathInstallRecord[]): CanonicalConfidence {
  let best: FastPathInstallRecord['identityStatus'] | undefined;
  for (const record of records) {
    if (!best || IDENTITY_STATUS_RANK[record.identityStatus] > IDENTITY_STATUS_RANK[best]) {
      best = record.identityStatus;
    }
  }
  switch (best) {
    case 'verified':
      return 'EXACT';
    case 'backfilled':
      return 'HIGH';
    case 'ambiguous':
      return 'POSSIBLE';
    default:
      return 'UNKNOWN';
  }
}

function toInstallEvidence(records: FastPathInstallRecord[]): InstallEvidenceItem[] {
  return records.map((record) => ({
    launcher: record.platform,
    installPath: record.installPath,
    executablePath: record.executablePath,
    detectedAt: record.detectedAt,
    lastSeenAt: record.lastSeenAt,
    // install-discovery has no row-removal capability today — same rationale
    // as model.ts's toInstallEvidence: every detected installation stays
    // known once seen, so this is honestly always true for this source.
    active: true,
  }));
}

function isRecentlyDetected(records: FastPathInstallRecord[], nowIso: string): boolean {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return false;
  return records.some((record) => {
    const detected = Date.parse(record.detectedAt);
    return Number.isFinite(detected) && now - detected <= RECENT_WINDOW_MS && now - detected >= 0;
  });
}

function resolveTrainerFields(
  entry: TrainerCatalogEntry | undefined,
  discoveryEntry: DiscoveryCatalogEntry | undefined,
): {
  trainerAvailability: PersonalLibraryGame['trainerAvailability'];
  trainerCount: number;
} {
  if (entry) {
    if (entry.verificationStatus === 'verified') {
      return { trainerAvailability: 'VERIFIED', trainerCount: entry.cheatCount ?? 0 };
    }
    if (entry.hasModPack || entry.verificationStatus === 'community') {
      return { trainerAvailability: 'COMMUNITY', trainerCount: entry.cheatCount ?? 0 };
    }
    return { trainerAvailability: 'NONE', trainerCount: entry.cheatCount ?? 0 };
  }
  // No trainer-catalog row — fall back to the Discovery catalog's coarse
  // boolean signal. It cannot distinguish SOLITH-verified from
  // community-sourced, so 'COMMUNITY' is the honest ceiling here, never
  // 'VERIFIED' (that would overclaim SOLITH curation this table cannot
  // evidence), and trainerCount is unknown (Discovery tracks availability,
  // not a cheat count) so it stays 0 rather than fabricated.
  if (discoveryEntry?.trainerAvailable) {
    return { trainerAvailability: 'COMMUNITY', trainerCount: 0 };
  }
  return { trainerAvailability: 'NONE', trainerCount: 0 };
}

/** Mirrors TrainerLibraryPage.tsx's own basenameOfExecutablePath — same normalization, kept local so this module stays independently importable/testable. */
function basenameOfExecutablePath(executablePath: string): string {
  const normalized = executablePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? executablePath;
}

/**
 * Real trainerAccuracy for one game in the fast path, when receipt evidence
 * was supplied. Mirrors TrainerLibraryPage.tsx's `getReceiptEvidenceForEntry`
 * + its `computeTrainerAccuracy` call exactly (same "current" evidence
 * shape, same never-set-from-title-text discipline for
 * exactVersionEvidence/strongMatchEvidence) so a game visible in both this
 * fast path and the full Trainer Library view never disagrees about its
 * accuracy state. Never reimplements the reverify decision itself —
 * delegates entirely to deriveReceiptEvidence / needsReverify.
 */
function resolveTrainerAccuracy(
  trainerAvailability: PersonalLibraryGame['trainerAvailability'],
  catalogEntry: TrainerCatalogEntry | undefined,
  installRecords: FastPathInstallRecord[],
  latestReceipt: ValidationReceipt | null | undefined,
): TrainerAccuracyState {
  const hasTrainer = trainerAvailability !== 'NONE';
  if (!hasTrainer) return 'NONE';

  const receipt = latestReceipt ?? null;
  const installedExecutablePath = installRecords.find((r) => r.executablePath)?.executablePath;
  const installedExecutableName = installedExecutablePath
    ? basenameOfExecutablePath(installedExecutablePath)
    : undefined;

  const receiptEvidence = deriveReceiptEvidence(receipt, {
    executableName: installedExecutableName ?? receipt?.executableName ?? catalogEntry?.executables?.[0] ?? '',
    executableVersion: undefined,
    executableHash: undefined,
    trainerSource: catalogEntry?.sources?.[0]?.provider ?? receipt?.trainerSource ?? 'unknown',
    trainerVersionHint: undefined,
  });

  return computeTrainerAccuracy({
    hasTrainer,
    ...receiptEvidence,
    // Never set from title text alone — this fast path gathers no real
    // hash/version-match evidence beyond what deriveReceiptEvidence covers.
    exactVersionEvidence: false,
    exactVersionMismatch: false,
    strongMatchEvidence: false,
  });
}

/**
 * Pure composition: no I/O. Groups install records by catalogGameId, unions
 * in owned-confirmed and favorited ids, and produces one PersonalLibraryGame
 * per real catalogGameId this session has actual evidence for. A game with
 * neither an install record, an owned-confirmed mark, nor a favorite mark
 * never appears — never fabricated, only ever composed from real signals.
 *
 * Install records with no catalogGameId (unmatched installs — see
 * TrainerLibraryPage.tsx's `unmatchedInstalledGames`) are excluded: there is
 * no stable identity to key a PersonalLibraryGame on without one.
 */
export function buildMyGamesFastPath(input: MyGamesFastPathInput): PersonalLibraryGame[] {
  const installsByGameId = new Map<string, FastPathInstallRecord[]>();
  for (const record of input.installRecords) {
    if (!record.catalogGameId) continue;
    const list = installsByGameId.get(record.catalogGameId) ?? [];
    list.push(record);
    installsByGameId.set(record.catalogGameId, list);
  }

  const ownedIds = new Set(input.ownedCatalogGameIds);
  const favoriteIds = new Set(input.favoriteCatalogGameIds);

  const allGameIds = new Set<string>([...installsByGameId.keys(), ...ownedIds, ...favoriteIds]);

  const games: PersonalLibraryGame[] = [];
  for (const gameId of allGameIds) {
    const installRecords = installsByGameId.get(gameId) ?? [];
    const catalogEntry = input.catalogEntriesById[gameId];
    const discoveryEntry = input.discoveryEntriesById?.[gameId];
    const owned = ownedIds.has(gameId) ? true : 'unknown';
    const ownershipEvidence: OwnershipEvidenceItem[] =
      owned === true ? [{ source: 'user-confirmed', confidence: 'CONFIRMED', owned: true }] : [];
    const { trainerAvailability, trainerCount } = resolveTrainerFields(catalogEntry, discoveryEntry);
    const launchers = [...new Set(installRecords.map((r) => r.platform))];
    const title =
      catalogEntry?.displayName ??
      installRecords.find((r) => r.catalogDisplayName)?.catalogDisplayName ??
      discoveryEntry?.title ??
      gameId;
    const canonicalConfidence = resolveCanonicalConfidenceFromInstalls(installRecords);
    // Artwork audit (Mission 7) — this fast path is what Home/My Games
    // actually render through (see file header); it never resolved artwork
    // at all despite already having `catalogEntry` on hand, so every card
    // fed by it fell back to the branded placeholder regardless of real
    // cover-art availability (confirmed via a real-Electron DOM audit: 0 of
    // 28 Home cards / 0 of 11 My Games cards showed real artwork). Same
    // confidence-gated rule as model.ts's projectPersonalLibraryGame and
    // DetailBanner.tsx: only EXACT/HIGH canonical-identity confidence
    // trusts provider-derived (Steam CDN) artwork.
    const artworkConfidence = canonicalConfidence === 'EXACT' || canonicalConfidence === 'HIGH' ? 'trusted' : 'weak';
    const artworkUrl = catalogEntry
      ? resolveCatalogCoverUrl(catalogEntry, { canonicalConfidence: artworkConfidence })
      : undefined;

    games.push({
      gameId,
      title,
      running: input.runningCatalogGameId === gameId,
      installed: installRecords.length > 0,
      owned,
      favorite: favoriteIds.has(gameId),
      recentlyDetected: isRecentlyDetected(installRecords, input.nowIso),
      launchers,
      installEvidence: toInstallEvidence(installRecords),
      ownershipEvidence,
      canonicalConfidence,
      trainerAvailability,
      trainerCount,
      // Real when input.receiptsByGameId was supplied (see file header and
      // resolveTrainerAccuracy above) — falls back to the honest
      // 'VERSION_UNKNOWN' floor only when no receipt evidence was gathered
      // for this id.
      trainerAccuracy: resolveTrainerAccuracy(
        trainerAvailability,
        catalogEntry,
        installRecords,
        input.receiptsByGameId?.[gameId],
      ),
      versionEvidence: [],
      artworkUrl,
    });
  }

  return games;
}

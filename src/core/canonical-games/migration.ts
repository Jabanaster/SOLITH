import { listInstalledGames } from '../install-discovery/store.js';
import { getCatalogEntry } from '../trainer-catalog/store.js';
import { getGames } from '../games/index.js';
import type { InstalledGameRecord } from '../install-discovery/types.js';
import type { Game } from '../../shared/types/index.js';
import { resolveCanonicalGrouping } from './dedupe.js';
import { computeIdentityKey, generateCanonicalGameId, normalizeCanonicalTitle } from './identity.js';
import { createOrReuseCanonicalIdentityReviewItem, upsertCanonicalGame, upsertGameInstallation } from './store.js';
import type { CanonicalAmbiguousGroup } from './dedupe.js';
import type { CanonicalGame, CanonicalIdentityEvidence, GameInstallation } from './types.js';

export interface CanonicalMigrationReport {
  legacyInstalledGameRows: number;
  /** Rows sourced from the legacy manually-managed `games` table (Game Library), migrated as Standalone installations. */
  legacyManualGameRows: number;
  canonicalGamesProduced: number;
  installationsProduced: number;
  safeMerges: number;
  ambiguousCases: number;
  manualReviewCases: number;
}

export interface CanonicalMigrationPlan {
  canonicalGames: CanonicalGame[];
  installations: GameInstallation[];
  ambiguous: CanonicalAmbiguousGroup[];
  report: CanonicalMigrationReport;
}

/**
 * Builds identity evidence for one installed_games row. When the row already carries a
 * catalogGameId with no steamAppId of its own, the linked catalog entry's steamAppId
 * (when present) is pulled in as evidence too — this is what lets a Steam-sourced
 * catalog match and a bare catalog-id-only row converge on the same tier-1 identity
 * instead of splitting into two false-separate canonical games (Step 5/6).
 */
export function buildEvidenceFromInstalledGame(record: InstalledGameRecord): CanonicalIdentityEvidence {
  let steamAppId = record.steamAppId;
  if (steamAppId == null && record.catalogGameId) {
    const catalogEntry = getCatalogEntry(record.catalogGameId);
    if (catalogEntry?.steamAppId != null) {
      steamAppId = catalogEntry.steamAppId;
    }
  }

  return {
    sourceId: record.id,
    platform: record.platform,
    steamAppId,
    catalogGameId: record.catalogGameId,
    installIdentity: record.installIdentity,
    canonicalExecutablePath: record.canonicalExecutablePath,
    launcherAppId: record.launcherAppId,
    displayName: record.catalogDisplayName ?? record.displayName,
    installPath: record.installPath,
    executablePath: record.executablePath,
    detectedAt: record.detectedAt,
    lastSeenAt: record.lastSeenAt,
  };
}

/**
 * Builds identity evidence for one legacy `games` row (the manually-managed Game Library
 * table — distinct from `installed_games`). Treated as a 'manual' (Standalone) launcher
 * installation. sourceId is prefixed to keep it in a distinct namespace from
 * installed_games ids, since both tables use independently-generated string ids.
 */
export function buildEvidenceFromLegacyGame(game: Game): CanonicalIdentityEvidence {
  return {
    sourceId: `legacy-game:${game.id}`,
    platform: 'manual',
    installIdentity: `manual:${game.id}`,
    canonicalExecutablePath: game.executablePath,
    displayName: game.name,
    installPath: game.path,
    executablePath: game.executablePath,
    detectedAt: game.dateAdded,
    lastSeenAt: game.lastScan ?? game.dateAdded,
  };
}

function buildCanonicalGameForGroup(canonicalId: string, evidence: CanonicalIdentityEvidence[], nowIso: string): CanonicalGame {
  const withCatalogId = evidence.find((e) => e.catalogGameId);
  const catalogEntry = withCatalogId?.catalogGameId ? getCatalogEntry(withCatalogId.catalogGameId) : null;
  const displayName = catalogEntry?.displayName ?? evidence.find((e) => e.displayName)?.displayName ?? evidence[0].sourceId;
  const normalizedTitle = normalizeCanonicalTitle(displayName) ?? displayName.toLowerCase();
  const identityKey = computeIdentityKey(evidence[0]);

  return {
    id: canonicalId,
    displayName,
    normalizedTitle,
    aliases: [],
    genres: catalogEntry?.categories ?? [],
    playModes: [],
    eligibility: 'listed',
    supportState: catalogEntry?.hasModPack ? 'supported' : 'unknown',
    artworkIdentity: catalogEntry
      ? { headerUrl: catalogEntry.headerUrl, coverUrl: catalogEntry.coverUrl, iconUrl: catalogEntry.iconUrl }
      : undefined,
    catalogGameId: catalogEntry?.catalogGameId,
    identityStatus: identityKey.trusted ? 'verified' : 'backfilled',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function buildInstallationForEvidence(canonicalId: string, evidence: CanonicalIdentityEvidence): GameInstallation {
  return {
    id: `install:${canonicalId}:${evidence.installIdentity}`,
    canonicalGameId: canonicalId,
    launcher: evidence.platform,
    launcherGameId: evidence.launcherAppId,
    installPath: evidence.installPath,
    executablePath: evidence.executablePath,
    installIdentity: evidence.installIdentity,
    sourceInstalledGameId: evidence.sourceId,
    detectedAt: evidence.detectedAt,
    lastSeenAt: evidence.lastSeenAt,
  };
}

/**
 * Computes the canonical migration plan from the currently-loaded database's
 * installed_games table, without writing anything. Deterministic and idempotent —
 * running it twice against unchanged data produces identical canonical IDs (Step 12)
 * and does not duplicate ambiguous groups.
 */
export function planCanonicalMigration(nowIso: string): CanonicalMigrationPlan {
  const installedGames = listInstalledGames();
  const legacyGames = getGames();
  const evidenceList = [
    ...installedGames.map(buildEvidenceFromInstalledGame),
    ...legacyGames.map(buildEvidenceFromLegacyGame),
  ];
  const { groups, ambiguous } = resolveCanonicalGrouping(evidenceList);

  const canonicalGames: CanonicalGame[] = [];
  const installations: GameInstallation[] = [];

  for (const [canonicalId, evidence] of groups) {
    canonicalGames.push(buildCanonicalGameForGroup(canonicalId, evidence, nowIso));
    for (const item of evidence) {
      installations.push(buildInstallationForEvidence(canonicalId, item));
    }
  }

  const manualReviewCases = ambiguous.reduce((sum, group) => sum + group.evidence.length, 0);

  return {
    canonicalGames,
    installations,
    ambiguous,
    report: {
      legacyInstalledGameRows: installedGames.length,
      legacyManualGameRows: legacyGames.length,
      canonicalGamesProduced: canonicalGames.length,
      installationsProduced: installations.length,
      safeMerges: installations.length - canonicalGames.length,
      ambiguousCases: ambiguous.length,
      manualReviewCases,
    },
  };
}

/**
 * Persists a previously computed plan: idempotent upserts for canonical games and
 * installations (keyed by stable id / installIdentity), and files-or-reuses a review
 * row per ambiguous group rather than guessing. Never deletes installed_games or games
 * rows — purely additive (Step 8/9).
 */
export function applyCanonicalMigrationPlan(plan: CanonicalMigrationPlan): void {
  for (const game of plan.canonicalGames) {
    upsertCanonicalGame(game);
  }
  for (const installation of plan.installations) {
    upsertGameInstallation(installation);
  }
  for (const group of plan.ambiguous) {
    createOrReuseCanonicalIdentityReviewItem(group.reason, group.evidence);
  }
}

/** Dry-run entry point for Step 16 — computes and returns the report without persisting anything. */
export function dryRunCanonicalMigration(nowIso: string): CanonicalMigrationReport {
  return planCanonicalMigration(nowIso).report;
}

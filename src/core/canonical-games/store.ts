import db from '../database/index.js';
import type { IdentityReviewResolution } from '../trainer-catalog/identity-review.js';
import { generateCanonicalGameId, generateSeparateCanonicalGameId, computeIdentityKey } from './identity.js';
import { computeCanonicalIdentityReviewFingerprint } from './identity-review.js';
import type { CanonicalIdentityReviewItem, CanonicalIdentityReviewReason } from './identity-review.js';
import type { CanonicalGame, CanonicalIdentityEvidence, GameInstallation } from './types.js';

function parseCanonicalGameRow(row: Record<string, unknown>): CanonicalGame {
  return {
    id: String(row.id),
    displayName: String(row.displayName),
    normalizedTitle: String(row.normalizedTitle),
    aliases: JSON.parse(String(row.aliasesJson ?? '[]')),
    developer: row.developer ? String(row.developer) : undefined,
    publisher: row.publisher ? String(row.publisher) : undefined,
    releaseDate: row.releaseDate ? String(row.releaseDate) : undefined,
    genres: JSON.parse(String(row.genresJson ?? '[]')),
    playModes: JSON.parse(String(row.playModesJson ?? '[]')),
    eligibility: String(row.eligibility) as CanonicalGame['eligibility'],
    supportState: String(row.supportState) as CanonicalGame['supportState'],
    artworkIdentity: row.artworkIdentityJson ? JSON.parse(String(row.artworkIdentityJson)) : undefined,
    popularityMetadata: row.popularityMetadataJson ? JSON.parse(String(row.popularityMetadataJson)) : undefined,
    catalogGameId: row.catalogGameId ? String(row.catalogGameId) : undefined,
    identityStatus: String(row.identityStatus) as CanonicalGame['identityStatus'],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function parseInstallationRow(row: Record<string, unknown>): GameInstallation {
  return {
    id: String(row.id),
    canonicalGameId: String(row.canonicalGameId),
    launcher: String(row.launcher) as GameInstallation['launcher'],
    launcherGameId: row.launcherGameId ? String(row.launcherGameId) : undefined,
    installPath: row.installPath ? String(row.installPath) : undefined,
    executablePath: row.executablePath ? String(row.executablePath) : undefined,
    processNames: row.processNamesJson ? JSON.parse(String(row.processNamesJson)) : undefined,
    edition: row.edition ? String(row.edition) : undefined,
    buildVersion: row.buildVersion ? String(row.buildVersion) : undefined,
    launchUri: row.launchUri ? String(row.launchUri) : undefined,
    trainerProfileCompatible: row.trainerProfileCompatible == null ? undefined : Boolean(row.trainerProfileCompatible),
    installIdentity: String(row.installIdentity),
    sourceInstalledGameId: row.sourceInstalledGameId ? String(row.sourceInstalledGameId) : undefined,
    detectedAt: String(row.detectedAt),
    lastSeenAt: String(row.lastSeenAt),
  };
}

export function upsertCanonicalGame(game: CanonicalGame): void {
  db.prepare(
    `INSERT INTO canonical_games (
       id, displayName, normalizedTitle, aliasesJson, developer, publisher, releaseDate,
       genresJson, playModesJson, eligibility, supportState, artworkIdentityJson,
       popularityMetadataJson, catalogGameId, identityStatus, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       displayName = excluded.displayName,
       normalizedTitle = excluded.normalizedTitle,
       aliasesJson = excluded.aliasesJson,
       developer = excluded.developer,
       publisher = excluded.publisher,
       releaseDate = excluded.releaseDate,
       genresJson = excluded.genresJson,
       playModesJson = excluded.playModesJson,
       eligibility = excluded.eligibility,
       supportState = excluded.supportState,
       artworkIdentityJson = excluded.artworkIdentityJson,
       popularityMetadataJson = excluded.popularityMetadataJson,
       catalogGameId = excluded.catalogGameId,
       identityStatus = excluded.identityStatus,
       updatedAt = excluded.updatedAt`,
  ).run(
    game.id,
    game.displayName,
    game.normalizedTitle,
    JSON.stringify(game.aliases),
    game.developer ?? null,
    game.publisher ?? null,
    game.releaseDate ?? null,
    JSON.stringify(game.genres),
    JSON.stringify(game.playModes),
    game.eligibility,
    game.supportState,
    game.artworkIdentity ? JSON.stringify(game.artworkIdentity) : null,
    game.popularityMetadata ? JSON.stringify(game.popularityMetadata) : null,
    game.catalogGameId ?? null,
    game.identityStatus,
    game.createdAt,
    game.updatedAt,
  );
}

export function upsertGameInstallation(installation: GameInstallation): void {
  db.prepare(
    `INSERT INTO game_installations (
       id, canonicalGameId, launcher, launcherGameId, installPath, executablePath,
       processNamesJson, edition, buildVersion, launchUri, trainerProfileCompatible,
       installIdentity, sourceInstalledGameId, detectedAt, lastSeenAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(installIdentity) DO UPDATE SET
       canonicalGameId = excluded.canonicalGameId,
       launcher = excluded.launcher,
       launcherGameId = excluded.launcherGameId,
       installPath = excluded.installPath,
       executablePath = excluded.executablePath,
       processNamesJson = excluded.processNamesJson,
       edition = excluded.edition,
       buildVersion = excluded.buildVersion,
       launchUri = excluded.launchUri,
       trainerProfileCompatible = excluded.trainerProfileCompatible,
       sourceInstalledGameId = excluded.sourceInstalledGameId,
       lastSeenAt = excluded.lastSeenAt`,
  ).run(
    installation.id,
    installation.canonicalGameId,
    installation.launcher,
    installation.launcherGameId ?? null,
    installation.installPath ?? null,
    installation.executablePath ?? null,
    installation.processNames ? JSON.stringify(installation.processNames) : null,
    installation.edition ?? null,
    installation.buildVersion ?? null,
    installation.launchUri ?? null,
    installation.trainerProfileCompatible == null ? null : (installation.trainerProfileCompatible ? 1 : 0),
    installation.installIdentity,
    installation.sourceInstalledGameId ?? null,
    installation.detectedAt,
    installation.lastSeenAt,
  );
}

export function listCanonicalGames(): CanonicalGame[] {
  const rows = db.prepare('SELECT * FROM canonical_games ORDER BY displayName COLLATE NOCASE').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(parseCanonicalGameRow);
}

export function getCanonicalGame(id: string): CanonicalGame | null {
  const row = db.prepare('SELECT * FROM canonical_games WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parseCanonicalGameRow(row) : null;
}

export function listInstallationsForGame(canonicalGameId: string): GameInstallation[] {
  const rows = db
    .prepare('SELECT * FROM game_installations WHERE canonicalGameId = ? ORDER BY launcher')
    .all(canonicalGameId) as Array<Record<string, unknown>>;
  return rows.map(parseInstallationRow);
}

export function countGameInstallations(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM game_installations').get() as { c: number };
  return Number(row.c ?? 0);
}

/** Resolves a concrete detected installation (by install_identity) back to its canonical game, if migrated/known. */
export function resolveInstallationToCanonicalGame(installIdentity: string): CanonicalGame | null {
  const row = db
    .prepare('SELECT canonicalGameId FROM game_installations WHERE installIdentity = ?')
    .get(installIdentity) as { canonicalGameId?: string } | undefined;
  if (!row?.canonicalGameId) return null;
  return getCanonicalGame(row.canonicalGameId);
}

// --- Canonical identity review (Step 14) ---

function parseCanonicalReviewRow(row: Record<string, unknown>): CanonicalIdentityReviewItem | null {
  try {
    return {
      id: String(row.id),
      reason: String(row.reason) as CanonicalIdentityReviewReason,
      status: String(row.status) as CanonicalIdentityReviewItem['status'],
      evidence: JSON.parse(String(row.evidenceJson)) as CanonicalIdentityEvidence[],
      resolution: row.resolution ? (String(row.resolution) as IdentityReviewResolution) : undefined,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      resolvedAt: row.resolvedAt ? String(row.resolvedAt) : undefined,
    };
  } catch {
    return null;
  }
}

export function getCanonicalIdentityReviewItem(id: string): CanonicalIdentityReviewItem | null {
  const row = db.prepare('SELECT * FROM canonical_identity_review WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? parseCanonicalReviewRow(row) : null;
}

/** Creates a pending review row if this exact ambiguity fingerprint hasn't been seen before; never resets an already-decided row. */
export function createOrReuseCanonicalIdentityReviewItem(
  reason: CanonicalIdentityReviewReason,
  evidence: CanonicalIdentityEvidence[],
): CanonicalIdentityReviewItem {
  const id = computeCanonicalIdentityReviewFingerprint(reason, evidence);
  db.prepare(
    `INSERT INTO canonical_identity_review (id, reason, status, evidenceJson)
     VALUES (?, ?, 'pending', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, reason, JSON.stringify(evidence));
  const item = getCanonicalIdentityReviewItem(id);
  if (!item) throw new Error(`Failed to persist canonical identity review item ${id}`);
  return item;
}

export function listPendingCanonicalIdentityReviewItems(): CanonicalIdentityReviewItem[] {
  const rows = db
    .prepare(`SELECT * FROM canonical_identity_review WHERE status = 'pending' ORDER BY createdAt ASC, id ASC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(parseCanonicalReviewRow).filter((item): item is CanonicalIdentityReviewItem => item !== null);
}

export function getPendingCanonicalIdentityReviewCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM canonical_identity_review WHERE status = 'pending'`).get() as {
      c: number;
    }
  ).c;
}

/**
 * Applies a human resolution to a pending canonical ambiguity:
 * - keep-existing / ignore: mark resolved/ignored, no canonical game minted — the
 *   underlying installations stay unmigrated (not silently guessed).
 * - accept-incoming: mint one canonical game covering the whole evidence group.
 * - treat-separate: mint one distinct canonical game per evidence row (never merged).
 */
export function resolveCanonicalIdentityReviewItem(
  id: string,
  resolution: IdentityReviewResolution,
  nowIso: string,
): CanonicalIdentityReviewItem | null {
  const item = getCanonicalIdentityReviewItem(id);
  if (!item || item.status !== 'pending') return null;

  if (resolution === 'accept-incoming') {
    const trusted = item.evidence.find((e) => computeIdentityKey(e).trusted);
    const canonicalId = trusted
      ? generateCanonicalGameId(computeIdentityKey(trusted))
      : generateSeparateCanonicalGameId(item.evidence[0]);
    mintCanonicalGameForEvidence(canonicalId, item.evidence, nowIso);
  } else if (resolution === 'treat-separate') {
    for (const evidence of item.evidence) {
      mintCanonicalGameForEvidence(generateSeparateCanonicalGameId(evidence), [evidence], nowIso);
    }
  }

  const status = resolution === 'ignore' ? 'ignored' : 'resolved';
  db.prepare(
    `UPDATE canonical_identity_review
        SET status = ?, resolution = ?, updatedAt = ?, resolvedAt = ?
      WHERE id = ?`,
  ).run(status, resolution, nowIso, nowIso, id);

  return getCanonicalIdentityReviewItem(id);
}

function mintCanonicalGameForEvidence(canonicalId: string, evidence: CanonicalIdentityEvidence[], nowIso: string): void {
  const primary = evidence[0];
  const displayName = primary.displayName ?? primary.sourceId;
  upsertCanonicalGame({
    id: canonicalId,
    displayName,
    normalizedTitle: displayName.toLowerCase(),
    aliases: [],
    genres: [],
    playModes: [],
    eligibility: 'listed',
    supportState: 'unknown',
    catalogGameId: primary.catalogGameId,
    identityStatus: 'backfilled',
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  for (const item of evidence) {
    upsertGameInstallation({
      id: `install:${canonicalId}:${item.installIdentity}`,
      canonicalGameId: canonicalId,
      launcher: item.platform,
      launcherGameId: item.launcherAppId,
      installPath: item.installPath,
      executablePath: item.executablePath,
      installIdentity: item.installIdentity,
      sourceInstalledGameId: item.sourceId,
      detectedAt: item.detectedAt,
      lastSeenAt: item.lastSeenAt,
    });
  }
}

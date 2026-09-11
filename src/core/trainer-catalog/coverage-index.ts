/**
 * ROADMAP §online-foundation Mission 7 — trainer coverage index.
 *
 * Honesty note (see PR/report): `TrainerCatalogEntry` already separates
 * trainer metadata from any artifact binary — `cheats` live inline on
 * `ModPack` as structured data, not a downloaded blob, and fields like
 * `verificationStatus`, `certLevel`, `cheatCount`, `hasModPack`, and
 * `modPackId` are already queryable without touching an artifact. This
 * module is therefore mostly a *re-shaping* of existing catalog fields
 * into the flat coverage-record shape the owner asked for, plus the one
 * genuinely new join: optionally attaching a `trainer_artifacts` row
 * (Mission 8) by hash/size so a caller can see artifact presence without
 * fetching the artifact itself. `projectTrainerCoverage` is a pure
 * projector — it does not query the database itself, so it stays trivially
 * testable and composes with any data source (live catalog store, sync
 * manifest, etc.) that hands it an entry.
 */
import type { TrainerCatalogEntry, VerificationStatus } from './types.js';

/** Reuses the catalog's existing verification/trust vocabulary — no new trust taxonomy is introduced. */
export type TrainerCoverageTrustState = VerificationStatus;

export interface TrainerCoverageArtifactRef {
  artifactHash: string;
  sizeBytes: number;
}

export interface TrainerCoverageRecord {
  gameId: string;
  trainerAvailable: boolean;
  trainerId?: string;
  trainerVersion?: string;
  gameBuildHint?: string;
  cheatCount: number;
  trustState: TrainerCoverageTrustState;
  artifactHash?: string;
  artifactSizeBytes?: number;
  lastUpdated: string;
  author?: string;
  source?: string;
}

/**
 * Pure projection of a `TrainerCatalogEntry` (plus an optional artifact
 * reference) into a flat coverage record. Never queries the database or an
 * artifact store itself — callers supply whatever they already have.
 */
export function projectTrainerCoverage(entry: TrainerCatalogEntry, artifact?: TrainerCoverageArtifactRef): TrainerCoverageRecord {
  const trainerAvailable = entry.hasModPack === true;
  const gameBuildHint = entry.executables.length > 0 ? entry.executables[0] : undefined;
  const lastUpdated = entry.contentUpdatedAt ?? entry.createdAt ?? '';
  const sourceEntry = entry.sources.length > 0 ? entry.sources[0] : undefined;

  return {
    gameId: entry.catalogGameId,
    trainerAvailable,
    cheatCount: entry.cheatCount,
    trustState: entry.verificationStatus,
    lastUpdated,
    ...(trainerAvailable && entry.modPackId ? { trainerId: entry.modPackId } : {}),
    ...(gameBuildHint ? { gameBuildHint } : {}),
    ...(artifact ? { artifactHash: artifact.artifactHash, artifactSizeBytes: artifact.sizeBytes } : {}),
    ...(sourceEntry ? { source: sourceEntry.provider } : {}),
  };
}

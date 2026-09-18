import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import type { ModPackSourceProvider } from '../trainer-catalog/types.js';
import type { HubCertificationLevel } from '../trainer-catalog/store.js';
import type { TrainerStorageError } from './errors.js';

export type StorageResult<T> = { success: true; value: T } | { success: false; error: TrainerStorageError };

export function ok<T>(value: T): StorageResult<T> {
  return { success: true, value };
}

export function fail<T = never>(error: TrainerStorageError): StorageResult<T> {
  return { success: false, error };
}

/**
 * Coarse classification of where a persisted definition's content came from.
 * Distinct from `ModPackSourceProvider` (which is the specific provider,
 * e.g. 'mrantifun'/'fling') — this is the P4-8 section-20-style bucket used
 * to reason about authority without a giant switch on every provider value.
 */
export type TrainerDefinitionSourceType =
  | 'bundled'
  | 'manual'
  | 'ct_import'
  | 'yaml_import'
  | 'hub_sync'
  | 'community_listing'
  | 'unknown';

/** A competing trainer_mod_packs row for the same catalog game that was NOT selected. Surfaced, never hidden. */
export interface ConflictingTrainerSource {
  packId: string;
  sourceProvider: ModPackSourceProvider | string;
  syncedAt: string;
}

export interface TrainerDefinitionProvenance {
  sourceType: TrainerDefinitionSourceType;
  sourceProvider: ModPackSourceProvider | string;
  /** Caller-supplied external-source identifier (CT file sha256, hub record id, yaml filename), when known. */
  sourceId: string | null;
  certLevel: HubCertificationLevel;
  /** True when the stored payload had no schemaVersion field and was migrated on read via the P4-2 legacy-unversioned step. */
  migratedFromLegacy: boolean;
  /** Last successful sync time for this specific packId (existing trainer_mod_packs.syncedAt semantics — unchanged). */
  syncedAt: string;
  /** Canonical "last locally modified" timestamp for this packId (trainer_mod_packs.updatedAt — see timestamp convergence rule). */
  updatedAt: string;
  /** Other trainer_mod_packs rows that exist for the same catalog game but were NOT selected (mission §21: no silent overwrite/hide). */
  conflictingSources: ConflictingTrainerSource[];
}

export interface CanonicalTrainerRecord {
  catalogGameId: string;
  packId: string;
  definition: SolithDefinitionV1;
  provenance: TrainerDefinitionProvenance;
}

export interface TrainerDefinitionListResult {
  records: CanonicalTrainerRecord[];
  /** Record-level read failures (corrupt payload, unsupported version, etc.) — collected, never a reason to abort the whole list (mission §23). */
  failures: Array<{ catalogGameId: string; error: TrainerStorageError }>;
}

export interface SaveTrainerDefinitionInput {
  sourceProvider: ModPackSourceProvider;
  sourceId?: string | null;
  /**
   * Remote-authoritative sync metadata (P4-4 hub convergence). Omit for any
   * locally-originated write — defaults stay exactly as before (local write
   * time as syncedAt, certLevel inferred from sourceProvider, updatedAt 0).
   * A caller that owns a remote source of truth (currently only the Solith
   * Hub sync client) supplies these so `TrainerDefinitionProvenance` reflects
   * the remote record's own timestamps/certification instead of the moment
   * this process happened to write it.
   */
  syncedAt?: string;
  certLevel?: HubCertificationLevel;
  remoteUpdatedAt?: number;
}

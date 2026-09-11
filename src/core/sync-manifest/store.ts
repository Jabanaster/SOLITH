/**
 * ROADMAP §online-foundation Mission 10 — sync manifest cursor persistence.
 *
 * Thin row-mapping wrapper around the `sync_manifest_state` table (see
 * src/core/database/index.ts applySchema()). One row per logical remote
 * service (e.g. 'discovery-catalog'); tracks the last-applied revision so a
 * later sync can request a delta instead of a full manifest every time.
 */

import db from '../database/index.js';
import type { SyncManifestState } from './types.js';

interface SyncManifestStateRow {
  service: string;
  catalogRevision: string | null;
  trainerRevision: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
}

function rowToState(row: SyncManifestStateRow): SyncManifestState {
  return {
    service: row.service,
    catalogRevision: row.catalogRevision,
    trainerRevision: row.trainerRevision,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncStatus: row.lastSyncStatus,
  };
}

export function getSyncManifestState(service: string): SyncManifestState | null {
  const row = db.prepare('SELECT * FROM sync_manifest_state WHERE service = ?').get(service) as
    | SyncManifestStateRow
    | undefined;
  return row ? rowToState(row) : null;
}

export interface RecordSyncManifestStateInput {
  catalogRevision?: string | null;
  trainerRevision?: string | null;
  lastSyncStatus?: string | null;
}

/** Upserts the cursor row for `service`, stamping `lastSyncedAt` to now. */
export function recordSyncManifestState(service: string, input: RecordSyncManifestStateInput): SyncManifestState {
  db.prepare(
    `INSERT INTO sync_manifest_state (service, catalogRevision, trainerRevision, lastSyncedAt, lastSyncStatus)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(service) DO UPDATE SET
       catalogRevision = excluded.catalogRevision,
       trainerRevision = excluded.trainerRevision,
       lastSyncedAt = excluded.lastSyncedAt,
       lastSyncStatus = excluded.lastSyncStatus`,
  ).run(
    service,
    input.catalogRevision ?? null,
    input.trainerRevision ?? null,
    input.lastSyncStatus ?? null,
  );

  const updated = getSyncManifestState(service);
  if (!updated) throw new Error(`Failed to persist sync manifest state for service ${service}`);
  return updated;
}

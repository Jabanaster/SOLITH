import db from '../database/index.js';
import type { CatalogUpdateApplyStatus, CatalogUpdateHistoryEntry, CatalogUpdateState } from './types.js';

const DEFAULT_STATE: CatalogUpdateState = {
  currentVersion: 0,
  lastSuccessAt: null,
  lastCheckAt: null,
  autoUpdateEnabled: true,
  bundledSnapshotOnly: false,
  artworkNetworkOptOut: false,
};

interface StateRow {
  currentVersion: number;
  lastSuccessAt: string | null;
  lastCheckAt: string | null;
  autoUpdateEnabled: number;
  bundledSnapshotOnly: number;
  artworkNetworkOptOut: number;
}

export function getCatalogUpdateState(): CatalogUpdateState {
  const row = db.prepare(`SELECT * FROM catalog_update_state WHERE id = 1`).get() as StateRow | undefined;
  if (!row) return { ...DEFAULT_STATE };
  return {
    currentVersion: row.currentVersion,
    lastSuccessAt: row.lastSuccessAt,
    lastCheckAt: row.lastCheckAt,
    autoUpdateEnabled: row.autoUpdateEnabled === 1,
    bundledSnapshotOnly: row.bundledSnapshotOnly === 1,
    artworkNetworkOptOut: row.artworkNetworkOptOut === 1,
  };
}

/** Partial update — only supplied fields change; everything else preserves its current stored value. */
export function updateCatalogUpdateState(patch: Partial<CatalogUpdateState>): CatalogUpdateState {
  const current = getCatalogUpdateState();
  const next: CatalogUpdateState = { ...current, ...patch };
  db.prepare(
    `INSERT INTO catalog_update_state (id, currentVersion, lastSuccessAt, lastCheckAt, autoUpdateEnabled, bundledSnapshotOnly, artworkNetworkOptOut)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       currentVersion = excluded.currentVersion,
       lastSuccessAt = excluded.lastSuccessAt,
       lastCheckAt = excluded.lastCheckAt,
       autoUpdateEnabled = excluded.autoUpdateEnabled,
       bundledSnapshotOnly = excluded.bundledSnapshotOnly,
       artworkNetworkOptOut = excluded.artworkNetworkOptOut`,
  ).run(
    next.currentVersion,
    next.lastSuccessAt,
    next.lastCheckAt,
    next.autoUpdateEnabled ? 1 : 0,
    next.bundledSnapshotOnly ? 1 : 0,
    next.artworkNetworkOptOut ? 1 : 0,
  );
  return next;
}

interface HistoryRow {
  id: number;
  version: number;
  appliedAt: string;
  recordCount: number;
  notice: string;
  status: string;
  rejectReason: string | null;
  rollbackDataJson: string | null;
}

function rowToHistoryEntry(row: HistoryRow): CatalogUpdateHistoryEntry {
  return {
    id: row.id,
    version: row.version,
    appliedAt: row.appliedAt,
    recordCount: row.recordCount,
    notice: row.notice,
    status: row.status as CatalogUpdateApplyStatus,
    ...(row.rejectReason != null ? { rejectReason: row.rejectReason } : {}),
  };
}

export interface RollbackSnapshotRow {
  catalogGameId: string;
  /** JSON of the full previous TrainerCatalogEntry, or null if the entry did not exist before this record was applied (i.e. rollback = delete it). */
  previousEntryJson: string | null;
}

export function recordCatalogUpdateHistory(params: {
  version: number;
  appliedAt: string;
  recordCount: number;
  notice: string;
  status: CatalogUpdateApplyStatus;
  rejectReason?: string;
  rollback?: RollbackSnapshotRow[];
}): number {
  const result = db
    .prepare(
      `INSERT INTO catalog_update_history (version, appliedAt, recordCount, notice, status, rejectReason, rollbackDataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.version,
      params.appliedAt,
      params.recordCount,
      params.notice,
      params.status,
      params.rejectReason ?? null,
      params.rollback ? JSON.stringify(params.rollback) : null,
    );
  return Number(result.lastInsertRowid);
}

export function listCatalogUpdateHistory(limit = 50): CatalogUpdateHistoryEntry[] {
  const rows = db
    .prepare(`SELECT * FROM catalog_update_history ORDER BY id DESC LIMIT ?`)
    .all(limit) as HistoryRow[];
  return rows.map(rowToHistoryEntry);
}

export function getCatalogUpdateHistoryEntry(id: number): { entry: CatalogUpdateHistoryEntry; rollback: RollbackSnapshotRow[] } | null {
  const row = db.prepare(`SELECT * FROM catalog_update_history WHERE id = ?`).get(id) as HistoryRow | undefined;
  if (!row) return null;
  return {
    entry: rowToHistoryEntry(row),
    rollback: row.rollbackDataJson ? (JSON.parse(row.rollbackDataJson) as RollbackSnapshotRow[]) : [],
  };
}

export function markCatalogUpdateHistoryRolledBack(id: number): void {
  db.prepare(`UPDATE catalog_update_history SET status = 'rolled-back' WHERE id = ?`).run(id);
}

import db from '../database/index.js';
import type { PointerMap } from './pointer-map.js';

/**
 * Phase 2 P2-2 persistence for pointer maps (ROADMAP §8/§9). A saved map is
 * driver-independent by construction — PointerMap/PointerMapNode never hold
 * an OS handle or a live PID, only module-relative offset chains and a
 * historical `targetAddress`/`lastResolvedAddress` string, so nothing here
 * needs redacting before it hits disk. What DOES need enforcing on the way
 * back out is that a reloaded map is never treated as live truth until it
 * is explicitly re-resolved — see `toInactiveOnLoad` below.
 */

export const POINTER_MAP_SCHEMA_VERSION = 1;

/** Hard ceiling on a single map's serialized size, so a corrupted or runaway map can't be persisted. */
export const MAX_SERIALIZED_MAP_BYTES = 2 * 1024 * 1024;

export interface PointerMapSaveIdentity {
  gameId?: string;
  executableIdentity?: string;
  architecture?: string;
}

export type PointerMapLoadResult =
  | { ok: true; map: PointerMap }
  | { ok: false; error: 'not_found' | 'unsupported_schema_version' | 'corrupt' };

interface PointerMapRow {
  mapId: string;
  name: string;
  schemaVersion: number;
  gameId: string | null;
  executableIdentity: string | null;
  architecture: string | null;
  data: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A map reloaded from disk is stale by definition — the concrete addresses
 * it once resolved to are only valid for a process instance that may no
 * longer exist. Every node comes back `unresolved` with no last-resolved
 * address, so a caller cannot accidentally act on a pre-restart address
 * without calling resolveMap/refreshMap first (ROADMAP §8: "INACTIVE /
 * NEEDS_RESOLUTION until explicitly attached to a current target").
 */
function toInactiveOnLoad(map: PointerMap): PointerMap {
  return {
    ...map,
    nodes: map.nodes.map((node) => ({ ...node, status: 'unresolved', lastResolvedAddress: null, lastResolvedAt: null })),
  };
}

/** Saves (creates or overwrites) a pointer map. Rejects an oversized map rather than truncating it silently. */
export function savePointerMap(map: PointerMap, identity: PointerMapSaveIdentity = {}): { ok: true } | { ok: false; error: 'oversized' } {
  const serialized = JSON.stringify(map);
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_SERIALIZED_MAP_BYTES) {
    return { ok: false, error: 'oversized' };
  }
  db.prepare(
    `INSERT INTO pointer_maps (mapId, name, schemaVersion, gameId, executableIdentity, architecture, data, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mapId) DO UPDATE SET
       name = excluded.name,
       schemaVersion = excluded.schemaVersion,
       gameId = excluded.gameId,
       executableIdentity = excluded.executableIdentity,
       architecture = excluded.architecture,
       data = excluded.data,
       updatedAt = excluded.updatedAt`,
  ).run(
    map.id,
    map.name,
    POINTER_MAP_SCHEMA_VERSION,
    identity.gameId ?? null,
    identity.executableIdentity ?? null,
    identity.architecture ?? null,
    serialized,
    map.createdAt,
    map.updatedAt,
  );
  return { ok: true };
}

/** Loads one map by id, inactive and needing re-resolution — see toInactiveOnLoad. */
export function loadPointerMap(mapId: string): PointerMapLoadResult {
  const row = db.prepare(`SELECT * FROM pointer_maps WHERE mapId = ?`).get(mapId) as PointerMapRow | undefined;
  if (!row) return { ok: false, error: 'not_found' };
  if (row.schemaVersion !== POINTER_MAP_SCHEMA_VERSION) return { ok: false, error: 'unsupported_schema_version' };
  try {
    const parsed = JSON.parse(row.data) as unknown;
    if (!isWellFormedPointerMap(parsed)) return { ok: false, error: 'corrupt' };
    return { ok: true, map: toInactiveOnLoad(parsed) };
  } catch {
    return { ok: false, error: 'corrupt' };
  }
}

export interface PointerMapSummary {
  mapId: string;
  name: string;
  nodeCount: number;
  gameId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lists every saved map's metadata without deserializing each one's full node array. */
export function listSavedPointerMaps(): PointerMapSummary[] {
  const rows = db.prepare(`SELECT mapId, name, gameId, data, createdAt, updatedAt FROM pointer_maps ORDER BY updatedAt DESC`).all() as Array<
    Pick<PointerMapRow, 'mapId' | 'name' | 'gameId' | 'data' | 'createdAt' | 'updatedAt'>
  >;
  return rows.map((row) => {
    let nodeCount = 0;
    try {
      const parsed = JSON.parse(row.data) as { nodes?: unknown[] };
      nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    } catch {
      nodeCount = 0;
    }
    return { mapId: row.mapId, name: row.name, nodeCount, gameId: row.gameId, createdAt: row.createdAt, updatedAt: row.updatedAt };
  });
}

export function deleteSavedPointerMap(mapId: string): void {
  db.prepare(`DELETE FROM pointer_maps WHERE mapId = ?`).run(mapId);
}

/** Minimal structural validation — rejects malformed chains rather than trusting whatever JSON.parse returns. */
function isWellFormedPointerMap(value: unknown): value is PointerMap {
  if (typeof value !== 'object' || value === null) return false;
  const map = value as Partial<PointerMap>;
  if (typeof map.id !== 'string' || typeof map.name !== 'string') return false;
  if (typeof map.createdAt !== 'string' || typeof map.updatedAt !== 'string') return false;
  if (!Array.isArray(map.nodes)) return false;
  return (map.nodes as unknown[]).every((node: unknown) => {
    if (typeof node !== 'object' || node === null) return false;
    const n = node as Record<string, unknown>;
    if (typeof n.id !== 'string' || typeof n.label !== 'string') return false;
    if (typeof n.path !== 'object' || n.path === null) return false;
    const path = n.path as Record<string, unknown>;
    if (typeof path.moduleName !== 'string' || typeof path.moduleOffset !== 'number') return false;
    return Array.isArray(path.offsets) && path.offsets.every((offset) => typeof offset === 'number');
  });
}

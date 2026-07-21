/**
 * Phase 9 — session snapshot serialize + watchlist diff (no memory I/O).
 * Persist helpers write JSON under a caller-provided root (e.g. userData/research-sessions).
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SnapshotWatchItem {
  address: string;
  type: string;
  lastValue: number | string | null;
  label?: string;
}

export interface SnapshotModuleBase {
  name: string;
  baseAddress: string;
  size: number;
}

export interface SessionSnapshot {
  schemaVersion: 1;
  timestamp: string;
  pid: number;
  processName: string;
  watchlist: SnapshotWatchItem[];
  matchSetIds: string[];
  /** Module bases observed at snapshot time (not full memory dumps). */
  moduleBases?: SnapshotModuleBase[];
  notes?: string;
  pointerTarget?: string;
}

export interface SessionSnapshotDiff {
  added: SnapshotWatchItem[];
  removed: SnapshotWatchItem[];
  changed: Array<{
    address: string;
    type: string;
    old: number | string | null;
    new: number | string | null;
    label?: string;
  }>;
  matchSetIdsAdded: string[];
  matchSetIdsRemoved: string[];
}

function addrKey(a: string): string {
  return a.trim().toLowerCase();
}

export class SessionSnapshotManager {
  create(input: Omit<SessionSnapshot, 'schemaVersion' | 'timestamp'> & { timestamp?: string }): SessionSnapshot {
    return {
      schemaVersion: 1,
      timestamp: input.timestamp ?? new Date().toISOString(),
      pid: input.pid,
      processName: input.processName,
      watchlist: input.watchlist.map((w) => ({ ...w })),
      matchSetIds: [...input.matchSetIds],
      moduleBases: input.moduleBases?.map((m) => ({ ...m })),
      notes: input.notes,
      pointerTarget: input.pointerTarget,
    };
  }

  diff(oldSnap: SessionSnapshot, newSnap: SessionSnapshot): SessionSnapshotDiff {
    const oldMap = new Map(oldSnap.watchlist.map((w) => [addrKey(w.address), w]));
    const newMap = new Map(newSnap.watchlist.map((w) => [addrKey(w.address), w]));

    const added: SnapshotWatchItem[] = [];
    const removed: SnapshotWatchItem[] = [];
    const changed: SessionSnapshotDiff['changed'] = [];

    for (const [addr, item] of newMap) {
      const prev = oldMap.get(addr);
      if (!prev) added.push(item);
      else if (prev.lastValue !== item.lastValue || prev.type !== item.type) {
        changed.push({
          address: item.address,
          type: item.type,
          old: prev.lastValue,
          new: item.lastValue,
          label: item.label ?? prev.label,
        });
      }
    }

    for (const [addr, item] of oldMap) {
      if (!newMap.has(addr)) removed.push(item);
    }

    const oldIds = new Set(oldSnap.matchSetIds);
    const newIds = new Set(newSnap.matchSetIds);

    return {
      added,
      removed,
      changed,
      matchSetIdsAdded: [...newIds].filter((id) => !oldIds.has(id)),
      matchSetIdsRemoved: [...oldIds].filter((id) => !newIds.has(id)),
    };
  }

  /** Sanitize filename segment — letters, digits, dash, underscore only. */
  static safeFileStem(stem: string): string {
    const cleaned = stem.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
    return cleaned.length > 0 ? cleaned : 'session';
  }

  /**
   * Write snapshot JSON under `sessionsRoot`. Path must stay inside root (no `..`).
   * Returns absolute file path written.
   */
  saveToDirectory(sessionsRoot: string, snapshot: SessionSnapshot, label?: string): string {
    const root = path.resolve(sessionsRoot);
    fs.mkdirSync(root, { recursive: true });
    const stem = SessionSnapshotManager.safeFileStem(
      label ?? `${snapshot.processName}-${snapshot.pid}-${Date.now()}`,
    );
    const filePath = path.resolve(root, `${stem}.json`);
    const rel = path.relative(root, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('snapshot_path_escapes_root');
    }
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    return filePath;
  }

  loadFromFile(filePath: string): SessionSnapshot {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionSnapshot;
    if (raw?.schemaVersion !== 1 || !Array.isArray(raw.watchlist)) {
      throw new Error('invalid_session_snapshot');
    }
    return raw;
  }
}

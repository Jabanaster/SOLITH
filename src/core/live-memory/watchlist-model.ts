/**
 * Phase 2 P2-8 — Watchlists (ROADMAP.md's own checkpoint assignment: "Memory
 * map + watchlists" lives under P2-8, not P2-7 — see
 * Docs/phase2/031-p2-6-p2-9-authoritative-requirement-matrix.md).
 *
 * A watch item's address SOURCE preserves provenance (spec §15) — never
 * collapsed into a bare absolute address. Resolution happens in
 * live-memory-session.ts (it needs live driver/module/pointer-map/structure
 * state); this module holds only the data shapes, ids, and resource limits.
 */
import type { CandidateFieldWidth } from './structure-model.js';
import type { TypedMemoryView } from './typed-memory-view.js';

export type WatchAddressSource =
  | { kind: 'absolute'; address: string }
  | { kind: 'module_relative'; moduleName: string; offset: string }
  | { kind: 'pointer_map_node'; mapId: string; nodeId: string }
  | { kind: 'structure_field'; structureId: string; offset: number };

export type WatchResolveState = 'live' | 'rebound' | 'stale' | 'unresolved' | 'process_exited';

export type WatchChangeState = 'never_read' | 'unchanged' | 'changed' | 'became_readable' | 'became_unreadable';

export interface WatchItem {
  id: string;
  /** User-supplied only — inference never assigns a label (spec §14). */
  label: string | null;
  source: WatchAddressSource;
  width: CandidateFieldWidth;
  refreshIntervalMs: number;
  resolveState: WatchResolveState;
  /** The absolute address this watch item last resolved to, when resolveState is 'live' or 'rebound'. */
  resolvedAddressHex: string | null;
  currentValue: TypedMemoryView | null;
  previousValue: TypedMemoryView | null;
  changeState: WatchChangeState;
  createdAt: string;
  lastRefreshedAt: string | null;
}

const WATCH_ID_PREFIX = 'watch';

export function createWatchItemId(): string {
  return `${WATCH_ID_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Spec §36 resource limit — bounds the per-session watchlist size. */
export const MAX_WATCH_ITEMS_PER_SESSION = 200;
export const MIN_WATCH_REFRESH_INTERVAL_MS = 200;
export const MAX_WATCH_REFRESH_INTERVAL_MS = 60_000;
export const DEFAULT_WATCH_REFRESH_INTERVAL_MS = 1000;

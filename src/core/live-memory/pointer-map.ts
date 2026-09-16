import { isProcessGoneError } from './memory-scanner.js';
import { resolvePointerPath, type LivePointerPath } from './pointer-resolver.js';
import type { PointerPathCandidate } from './pointer-scanner.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';
import { emptyStabilityState, type NodeStabilityState } from './pointer-stability.js';

/**
 * Phase 2 — the pointer-map data model (ROADMAP "pointer maps,
 * pointer-chain visualization"). Phase 1 built the truth-reporting
 * BFS reverse scan (`scanForPointerPath`) and single-path resolution
 * (`resolvePointerPath`), but a user's discoveries only ever lived as a
 * transient candidate list for one target address — there was no way to
 * name, keep, and re-resolve several pointer chains together, which is
 * the prerequisite a visualization (a later stage) needs to render
 * anything. This module is that persistent, named collection.
 *
 * Every mutation returns a new PointerMap rather than mutating in place,
 * matching the immutable-update convention used elsewhere in this codebase
 * (see watch-list-bookmarks.ts for the same shape at smaller scale).
 */

// process_exited is distinct from read_failed on purpose — Phase 1's D-series
// pointer work established that a dead-but-open process handle fails module
// enumeration (getModules throws) rather than silently returning nothing, so
// a caller can and must tell "this chain doesn't resolve" apart from "the
// process is gone" (isProcessGoneError, shared with memory-scanner.ts).
export type PointerMapNodeStatus = 'unresolved' | 'resolved' | 'module_missing' | 'read_failed' | 'process_exited';

export interface PointerMapNode {
  id: string;
  label: string;
  path: LivePointerPath;
  /** How many dereference levels this candidate required, as reported by the scan it came from. */
  depth: number;
  status: PointerMapNodeStatus;
  lastResolvedAddress: string | null;
  lastResolvedAt: string | null;
  createdAt: string;
  /**
   * The address this node's chain was discovered for (0x-prefixed hex), or
   * null for a manually-added node with no scan behind it. Provenance only —
   * never re-derived automatically as current truth after a restart.
   */
  targetAddress: string | null;
  /** Groups every node an orchestrated scanTargetsIntoMap call produced together, or null for a manual add. */
  scanId: string | null;
  /**
   * P2-4 — restart-stability evidence (mission §3). Optional in the TYPE
   * because a map persisted before this stage (schemaVersion 1) has no such
   * data on disk; every in-memory node this stage creates or loads always
   * populates it (see pointer-map-store.ts's migration and
   * pointerMapNodeFromCandidate below) — callers should treat a missing
   * value as `emptyStabilityState()`, never as an error.
   */
  stability?: NodeStabilityState;
}

export interface PointerMap {
  id: string;
  name: string;
  nodes: PointerMapNode[];
  createdAt: string;
  updatedAt: string;
}

export function createEmptyPointerMap(name: string): PointerMap {
  const now = new Date().toISOString();
  return {
    id: `pmap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    nodes: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface PointerMapNodeProvenance {
  targetAddress: string;
  scanId: string;
}

/** Builds an unresolved node from a scan candidate, ready to add to a map. */
export function pointerMapNodeFromCandidate(
  label: string,
  candidate: PointerPathCandidate,
  provenance: PointerMapNodeProvenance | null = null,
): PointerMapNode {
  return {
    id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    path: {
      moduleName: candidate.moduleName,
      moduleOffset: candidate.moduleOffset,
      offsets: candidate.offsets,
    },
    depth: candidate.depth,
    status: 'unresolved',
    lastResolvedAddress: null,
    lastResolvedAt: null,
    createdAt: new Date().toISOString(),
    targetAddress: provenance?.targetAddress ?? null,
    scanId: provenance?.scanId ?? null,
    stability: emptyStabilityState(),
  };
}

export function addPointerMapNode(map: PointerMap, node: PointerMapNode): PointerMap {
  return { ...map, nodes: [...map.nodes, node], updatedAt: new Date().toISOString() };
}

export function removePointerMapNode(map: PointerMap, id: string): PointerMap {
  return { ...map, nodes: map.nodes.filter((n) => n.id !== id), updatedAt: new Date().toISOString() };
}

export function renamePointerMap(map: PointerMap, name: string): PointerMap {
  return { ...map, name, updatedAt: new Date().toISOString() };
}

export interface PointerMapResolution {
  map: PointerMap;
  resolvedCount: number;
  failedCount: number;
}

/**
 * Re-resolves every node against the currently attached process. Must be
 * called again on every attach — see resolvePointerPath's own contract —
 * and each node's status/address is replaced from a real read this call
 * actually performed, not carried over from a previous resolution.
 */
export function resolvePointerMap(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  map: PointerMap,
): PointerMapResolution {
  let resolvedCount = 0;
  let failedCount = 0;
  const nodes = map.nodes.map((node) => {
    try {
      const address = resolvePointerPath(driver, handle, node.path);
      resolvedCount += 1;
      return {
        ...node,
        status: 'resolved' as const,
        lastResolvedAddress: `0x${address.toString(16)}`,
        lastResolvedAt: new Date().toISOString(),
      };
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      const status: PointerMapNodeStatus = isProcessGoneError(error)
        ? 'process_exited'
        : message.includes('is not currently loaded')
          ? 'module_missing'
          : 'read_failed';
      return { ...node, status, lastResolvedAddress: null };
    }
  });
  return { map: { ...map, nodes, updatedAt: new Date().toISOString() }, resolvedCount, failedCount };
}

export interface PointerChainStep {
  /** Human-readable label for this step, e.g. "game.exe+0x1a2b3c" or "+16". */
  label: string;
  /** True for the first step (the module-relative root); false for each dereference offset after it. */
  isRoot: boolean;
}

/**
 * Flattens a node's path into an ordered list of steps a visualization
 * component can render directly, without re-deriving module/offset
 * formatting itself. Pure and synchronous — it does not touch a live
 * process, so it works on unresolved nodes too.
 */
export function pointerMapNodeChainSteps(node: PointerMapNode): PointerChainStep[] {
  const steps: PointerChainStep[] = [
    { label: `${node.path.moduleName}+0x${node.path.moduleOffset.toString(16)}`, isRoot: true },
  ];
  for (const offset of node.path.offsets) {
    const sign = offset < 0 ? '-' : '+';
    steps.push({ label: `${sign}0x${Math.abs(offset).toString(16)}`, isRoot: false });
  }
  return steps;
}

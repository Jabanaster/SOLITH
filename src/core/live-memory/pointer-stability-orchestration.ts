import type { PointerMap, PointerMapNode } from './pointer-map.js';
import {
  validateNodeAfterRestart as validateNodeAfterRestartCore,
  summarizeNodeStability,
  emptyStabilityState,
  type StabilityGroundTruth,
  type StabilityObservation,
} from './pointer-stability.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

/**
 * Phase 2 P2-4 — pointer-map-level stability orchestration. Kept separate
 * from pointer-map.ts (the pure model) the same way pointer-map-orchestration.ts
 * already separates multi-target scan orchestration from it — this module
 * is the thing LiveMemorySession's session methods actually call.
 */

export interface NodeStabilityResult {
  map: PointerMap;
  observation: StabilityObservation;
}

/**
 * Validates ONE node against the currently attached process (mission §16's
 * "Validate After Restart" workflow, per-node granularity). Reuses this
 * node's own baseline (the first successful, ground-truth-verified
 * observation) — never re-derives or re-guesses it — and appends the new
 * observation to its history. Returns a new map; the input is never mutated.
 */
export function validateNodeAfterRestart(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  map: PointerMap,
  nodeId: string,
  groundTruth: StabilityGroundTruth,
  pid: number | null,
): NodeStabilityResult {
  const node = map.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Pointer map node "${nodeId}" not found.`);

  const stability = node.stability ?? emptyStabilityState();
  // Derived from how many observations already exist rather than tracked as
  // separate session state — a "campaign" is just this node's own history,
  // so there is nothing extra to start, forget to increment, or lose track
  // of across a session restart.
  const launchNumber = stability.observations.length + 1;
  const observation = validateNodeAfterRestartCore(
    driver,
    handle,
    node.path,
    stability.baseline,
    groundTruth,
    launchNumber,
    pid,
  );

  const isFirstVerified = !stability.baseline && !isFailureStatus(observation.status);
  const nextStability = {
    baseline: isFirstVerified
      ? {
          pid,
          moduleBase: observation.moduleBase,
          resolvedAddress: observation.resolvedAddress!,
          recordedAt: observation.observedAt,
        }
      : stability.baseline,
    observations: [...stability.observations, observation],
  };

  const nextNodes: PointerMapNode[] = map.nodes.map((n) => (n.id === nodeId ? { ...n, stability: nextStability } : n));
  return { map: { ...map, nodes: nextNodes, updatedAt: new Date().toISOString() }, observation };
}

function isFailureStatus(status: StabilityObservation['status']): boolean {
  return status === 'chain_broken' || status === 'module_missing' || status === 'read_failed' || status === 'process_exited' || status === 'false_positive';
}

export interface MapStabilityResult {
  map: PointerMap;
  observations: StabilityObservation[];
  /** Nodes skipped because the resolver had no ground truth for them — recorded, not silently dropped. */
  skippedNodeIds: string[];
}

/**
 * Validates every node in the map that has a ground-truth resolver
 * available (mission §16 applied map-wide, e.g. a "Validate After Restart"
 * button covering the whole map in one click). `groundTruthFor` returns
 * `null` for a node with no known ground truth (e.g. a manually-added node
 * with no fixture/real-game verification defined) — that node is recorded
 * in `skippedNodeIds`, never silently treated as validated.
 */
export function validateMapAfterRestart(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  map: PointerMap,
  groundTruthFor: (node: PointerMapNode) => StabilityGroundTruth | null,
  pid: number | null,
): MapStabilityResult {
  let workingMap = map;
  const observations: StabilityObservation[] = [];
  const skippedNodeIds: string[] = [];

  for (const node of map.nodes) {
    const groundTruth = groundTruthFor(node);
    if (!groundTruth) {
      skippedNodeIds.push(node.id);
      continue;
    }
    const result = validateNodeAfterRestart(driver, handle, workingMap, node.id, groundTruth, pid);
    workingMap = result.map;
    observations.push(result.observation);
  }

  return { map: workingMap, observations, skippedNodeIds };
}

/** Read-only summary accessor — never mutates, just re-derives from what's already stored. */
export function getNodeStabilitySummary(node: PointerMapNode) {
  return summarizeNodeStability(node.stability?.observations ?? []);
}

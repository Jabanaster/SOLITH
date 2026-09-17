import {
  scanForPointerPath,
  scanForPointerPathCancellable,
  type PointerScanBounds,
  type PointerScanTermination,
} from './pointer-scanner.js';
import { addPointerMapNode, pointerMapNodeFromCandidate, type PointerMap } from './pointer-map.js';
import type { CanonicalCompleteness } from './scanner-backend.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

/**
 * Phase 2 P2-2 — multi-level pointer scanning as ROADMAP actually means it:
 * one pointer scan with maxDepth > 1 satisfies "multi-level" for a single
 * chain, but the roadmap's "pointer maps" bullet is about several concrete
 * addresses populating one named collection in one operation. This module
 * is that orchestration, kept as pure functions over P2-1's immutable
 * PointerMap so it stays independently testable and has no session/IPC
 * dependency of its own — LiveMemorySession wires it to a live handle.
 */

/** Hard ceiling on target addresses accepted by one scanTargetsIntoMap call. */
export const MAX_TARGETS_PER_SCAN = 8;
/** Hard ceiling on nodes a single target may contribute to a map. */
export const MAX_NODES_PER_TARGET = 10;
/** Hard ceiling on total nodes a map may hold, across every scan that has populated it. */
export const MAX_NODES_PER_MAP = 200;

export interface PointerMapTargetOutcome {
  targetAddress: string;
  requestedDepth: number;
  deepestLevelCompleted: number;
  termination: PointerScanTermination;
  completeness: CanonicalCompleteness;
  candidateCount: number;
  nodesAdded: number;
  truncated: boolean;
}

export interface PointerMapScanTargetsResult {
  map: PointerMap;
  perTarget: PointerMapTargetOutcome[];
  /** Worst completeness across every target scanned — see aggregatePointerMapCompleteness. Never silently upgraded to 'complete'. */
  aggregateCompleteness: CanonicalCompleteness;
  targetsRequested: number;
  targetsScanned: number;
  /** True if any target list truncation, per-target node cap, or per-map node cap was actually hit. */
  resourceLimited: boolean;
}

// Ordered worst-to-best. Mirrors the "first terminal stop wins" precedent in
// scanner-backend-native.ts's CompletenessAccumulator, generalized to a fixed
// severity ranking since targets are scanned as an independent batch rather
// than sequential regions within one scan.
const COMPLETENESS_SEVERITY: Record<CanonicalCompleteness['state'], number> = {
  complete: 0,
  complete_with_skipped_regions: 1,
  resource_limit: 2,
  cancelled: 3,
  process_exited: 4,
  failed: 5,
};

/**
 * Reduces one completeness value per target to a single worst-case value.
 * Reuses the canonical vocabulary directly rather than inventing a parallel
 * map-level enum — see mission §6. Losing the *other* targets' exact reasons
 * in this one summary field is fine because every target's full outcome is
 * still available in `perTarget`; what §6 actually forbids is reporting
 * 'complete' when any target was not.
 */
export function aggregatePointerMapCompleteness(states: CanonicalCompleteness[]): CanonicalCompleteness {
  if (states.length === 0) return { state: 'complete' };
  let worst = states[0];
  for (const state of states) {
    if (COMPLETENESS_SEVERITY[state.state] > COMPLETENESS_SEVERITY[worst.state]) worst = state;
  }
  return worst;
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

/**
 * Scans one or more concrete target addresses into a map in one operation —
 * the actual "pointer maps" requirement, not just a single scan with
 * maxDepth > 1. Every node keeps which target and which scan run produced
 * it (mission §5), and no target's candidates are merged into another's.
 *
 * Cancellation (`bounds.signal`) is checked between targets, not mid-target
 * — scanForPointerPath already checks it mid-scan and reports `cancelled`
 * for that target; a target not yet reached when cancellation is observed
 * is recorded as cancelled with zero candidates, distinguishing "we did not
 * get to this one" from "we scanned it and found nothing" (mission §12).
 */
export function scanTargetsIntoMap(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  map: PointerMap,
  targets: bigint[],
  bounds?: PointerScanBounds,
): PointerMapScanTargetsResult {
  const targetsRequested = targets.length;
  const boundedTargets = targets.slice(0, MAX_TARGETS_PER_SCAN);
  let resourceLimited = boundedTargets.length < targetsRequested;

  let workingMap = map;
  const perTarget: PointerMapTargetOutcome[] = [];

  for (const target of boundedTargets) {
    const targetAddress = hex(target);

    if (bounds?.signal?.aborted) {
      perTarget.push({
        targetAddress,
        requestedDepth: bounds?.maxDepth ?? 0,
        deepestLevelCompleted: 0,
        termination: 'cancelled',
        completeness: { state: 'cancelled', atByte: 0n },
        candidateCount: 0,
        nodesAdded: 0,
        truncated: true,
      });
      continue;
    }

    const scanId = `pms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = scanForPointerPath(driver, handle, target, bounds);

    const remainingMapCapacity = Math.max(0, MAX_NODES_PER_MAP - workingMap.nodes.length);
    const nodeCapacityForTarget = Math.min(MAX_NODES_PER_TARGET, remainingMapCapacity);
    const candidatesToAdd = result.candidates.slice(0, nodeCapacityForTarget);
    if (candidatesToAdd.length < result.candidates.length) resourceLimited = true;

    candidatesToAdd.forEach((candidate, index) => {
      const node = pointerMapNodeFromCandidate(`${targetAddress} candidate ${index + 1}`, candidate, {
        targetAddress,
        scanId,
      });
      workingMap = addPointerMapNode(workingMap, node);
    });

    perTarget.push({
      targetAddress,
      requestedDepth: result.requestedDepth,
      deepestLevelCompleted: result.deepestLevelCompleted,
      termination: result.termination,
      completeness: result.completeness,
      candidateCount: result.candidates.length,
      nodesAdded: candidatesToAdd.length,
      truncated: result.truncated,
    });
  }

  return {
    map: workingMap,
    perTarget,
    aggregateCompleteness: aggregatePointerMapCompleteness(perTarget.map((t) => t.completeness)),
    targetsRequested,
    targetsScanned: boundedTargets.length,
    resourceLimited,
  };
}

/**
 * Real cancellable twin of `scanTargetsIntoMap` (P2-3.1 §5/§6). Identical
 * per-target orchestration, but awaits `scanForPointerPathCancellable`
 * instead of the synchronous `scanForPointerPath`, so a concurrently-issued
 * `bounds.signal`-triggered cancellation can interrupt mid-target (the
 * generator's own cancellation checkpoints), not just between targets. A
 * target not yet reached when cancellation lands is recorded as `cancelled`
 * with zero candidates — the same "we did not get to this one" vs "we
 * scanned it and found nothing" distinction the synchronous path already
 * makes (mission §12).
 */
export async function scanTargetsIntoMapCancellable(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  map: PointerMap,
  targets: bigint[],
  bounds?: PointerScanBounds,
): Promise<PointerMapScanTargetsResult> {
  const targetsRequested = targets.length;
  const boundedTargets = targets.slice(0, MAX_TARGETS_PER_SCAN);
  let resourceLimited = boundedTargets.length < targetsRequested;

  let workingMap = map;
  const perTarget: PointerMapTargetOutcome[] = [];

  for (const target of boundedTargets) {
    const targetAddress = hex(target);

    if (bounds?.signal?.aborted) {
      perTarget.push({
        targetAddress,
        requestedDepth: bounds?.maxDepth ?? 0,
        deepestLevelCompleted: 0,
        termination: 'cancelled',
        completeness: { state: 'cancelled', atByte: 0n },
        candidateCount: 0,
        nodesAdded: 0,
        truncated: true,
      });
      continue;
    }

    const scanId = `pms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // eslint-disable-next-line no-await-in-loop -- targets must scan sequentially: each one's node budget depends on the running map-capacity total from every target scanned before it.
    const result = await scanForPointerPathCancellable(driver, handle, target, bounds);

    const remainingMapCapacity = Math.max(0, MAX_NODES_PER_MAP - workingMap.nodes.length);
    const nodeCapacityForTarget = Math.min(MAX_NODES_PER_TARGET, remainingMapCapacity);
    const candidatesToAdd = result.candidates.slice(0, nodeCapacityForTarget);
    if (candidatesToAdd.length < result.candidates.length) resourceLimited = true;

    candidatesToAdd.forEach((candidate, index) => {
      const node = pointerMapNodeFromCandidate(`${targetAddress} candidate ${index + 1}`, candidate, {
        targetAddress,
        scanId,
      });
      workingMap = addPointerMapNode(workingMap, node);
    });

    perTarget.push({
      targetAddress,
      requestedDepth: result.requestedDepth,
      deepestLevelCompleted: result.deepestLevelCompleted,
      termination: result.termination,
      completeness: result.completeness,
      candidateCount: result.candidates.length,
      nodesAdded: candidatesToAdd.length,
      truncated: result.truncated,
    });
  }

  return {
    map: workingMap,
    perTarget,
    aggregateCompleteness: aggregatePointerMapCompleteness(perTarget.map((t) => t.completeness)),
    targetsRequested,
    targetsScanned: boundedTargets.length,
    resourceLimited,
  };
}

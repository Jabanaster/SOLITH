/**
 * Phase 2 P2-3 — pure, renderer-side pointer-map display logic. No React,
 * no IPC. Kept separate from PointerMapPanel.tsx so it can be unit-tested
 * the way this repo already tests UI-adjacent logic (see
 * tests/virtual-catalog-grid-columns.test.ts, tests/process-picker.test.ts)
 * without ever rendering a component.
 */

export type PointerMapNodeStatus = 'unresolved' | 'resolved' | 'module_missing' | 'read_failed' | 'process_exited';

export type BadgeVariant = 'safe' | 'caution' | 'risky' | 'blocked';

export interface BadgeView {
  label: string;
  variant: BadgeVariant;
}

const NODE_STATUS_BADGE: Record<PointerMapNodeStatus, BadgeView> = {
  resolved: { label: 'Resolved', variant: 'safe' },
  unresolved: { label: 'Unresolved', variant: 'caution' },
  module_missing: { label: 'Module Missing', variant: 'risky' },
  read_failed: { label: 'Read Failed', variant: 'risky' },
  process_exited: { label: 'Process Exited', variant: 'blocked' },
};

/** A failed node must never look like a successful candidate (mission §5). */
export function nodeStatusBadge(status: PointerMapNodeStatus): BadgeView {
  return NODE_STATUS_BADGE[status];
}

/**
 * A node that was resolved before (lastResolvedAt is set) but is currently
 * `unresolved` was forced back to that state by pointer-map-store.ts's
 * `toInactiveOnLoad` on reload — it is stale, not merely "not yet scanned."
 * Mission §5/§10: a stale/reloaded node must not display its historical
 * absolute address as if it were current authority.
 */
export function isStaleReloadedNode(node: Pick<PointerMapNodeDto, 'status' | 'lastResolvedAt'>): boolean {
  return node.status === 'unresolved' && node.lastResolvedAt !== null;
}

type CompletenessState = PointerMapCompletenessDto['state'];

const COMPLETENESS_BADGE: Record<CompletenessState, BadgeView> = {
  complete: { label: 'Complete', variant: 'safe' },
  complete_with_skipped_regions: { label: 'Complete (regions skipped)', variant: 'caution' },
  cancelled: { label: 'Cancelled', variant: 'caution' },
  resource_limit: { label: 'Resource Limited', variant: 'caution' },
  process_exited: { label: 'Process Exited', variant: 'blocked' },
  failed: { label: 'Failed', variant: 'risky' },
};

/**
 * Distinguishes COMPLETE from every incomplete reason (mission §6) — never
 * collapse "resource limited"/"cancelled"/"process exited" into a plain
 * success badge.
 */
export function completenessBadge(completeness: PointerMapCompletenessDto): BadgeView {
  return COMPLETENESS_BADGE[completeness.state];
}

const STABILITY_STATUS_BADGE: Record<StabilityStatusDto, BadgeView> = {
  stable_exact: { label: 'Stable (exact)', variant: 'safe' },
  stable_relocated: { label: 'Stable (relocated)', variant: 'safe' },
  target_moved_chain_valid: { label: 'Stable (heap moved)', variant: 'safe' },
  chain_broken: { label: 'Chain Broken', variant: 'risky' },
  module_missing: { label: 'Module Missing', variant: 'risky' },
  read_failed: { label: 'Read Failed', variant: 'risky' },
  process_exited: { label: 'Process Exited', variant: 'blocked' },
  false_positive: { label: 'False Positive', variant: 'blocked' },
};

/** A node with no observations yet is truthfully "not checked", never a silent green — mission §2's stale_unresolved. */
export function stabilityStatusBadge(status: StabilityStatusDto | null): BadgeView {
  if (!status) return { label: 'Not Yet Validated', variant: 'caution' };
  return STABILITY_STATUS_BADGE[status];
}

export interface StabilitySummaryView {
  attempts: number;
  correct: number;
  broken: number;
  falsePositive: number;
  stabilityRate: number;
}

const CORRECT_STABILITY_STATUSES: ReadonlySet<StabilityStatusDto> = new Set([
  'stable_exact',
  'stable_relocated',
  'target_moved_chain_valid',
]);
const BROKEN_STABILITY_STATUSES: ReadonlySet<StabilityStatusDto> = new Set([
  'chain_broken',
  'module_missing',
  'read_failed',
  'process_exited',
]);

/** Raw counts + rate, denominator always alongside it — never a fabricated-precision label (mission §10). */
export function summarizeStabilityObservations(observations: StabilityObservationDto[]): StabilitySummaryView {
  const attempts = observations.length;
  let correct = 0;
  let broken = 0;
  let falsePositive = 0;
  for (const obs of observations) {
    if (CORRECT_STABILITY_STATUSES.has(obs.status)) correct += 1;
    else if (BROKEN_STABILITY_STATUSES.has(obs.status)) broken += 1;
    else if (obs.status === 'false_positive') falsePositive += 1;
  }
  return { attempts, correct, broken, falsePositive, stabilityRate: attempts > 0 ? correct / attempts : 0 };
}

/** "resource_limit" -> "Resource limit". Used for termination reasons, which are free-form strings on the wire. */
export function humanizeSnakeCase(value: string): string {
  if (!value) return value;
  const words = value.split('_');
  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}${words.length > 1 ? ' ' + words.slice(1).join(' ') : ''}`;
}

export interface PointerChainStepView {
  label: string;
  isRoot: boolean;
}

/**
 * Ports P2-1's pointerMapNodeChainSteps (src/core/live-memory/pointer-map.ts)
 * for the wire DTO shape. Same semantics — the core function cannot be
 * imported here because it lives in the main-process bundle and operates on
 * a numeric moduleOffset, while the DTO's moduleOffset already crossed IPC
 * as a "0x…" string (see serializePointerMap in electron/live-memory-ipc.ts).
 * Does not re-derive pointer-chain semantics: it flattens the same
 * module+offsets fields the core model already resolved, nothing more.
 */
export function pointerMapDtoNodeChainSteps(node: PointerMapNodeDto): PointerChainStepView[] {
  const steps: PointerChainStepView[] = [{ label: `${node.path.moduleName}+${node.path.moduleOffset}`, isRoot: true }];
  for (const offset of node.path.offsets) {
    const sign = offset < 0 ? '-' : '+';
    steps.push({ label: `${sign}0x${Math.abs(offset).toString(16)}`, isRoot: false });
  }
  return steps;
}

export interface PointerMapTargetGroup {
  /** The real target address, or null for manually-added nodes with no scan behind them. */
  targetAddress: string | null;
  nodes: PointerMapNodeDto[];
}

/**
 * Groups nodes by their scan-provenance target address, preserving first-seen
 * order. Mission §4: "do not flatten two targets into one undifferentiated
 * candidate list." Manually-added nodes (targetAddress === null) form their
 * own trailing group rather than being silently merged into another target.
 */
export function groupNodesByTarget(nodes: PointerMapNodeDto[]): PointerMapTargetGroup[] {
  const order: Array<string | null> = [];
  const byTarget = new Map<string | null, PointerMapNodeDto[]>();
  for (const node of nodes) {
    const key = node.targetAddress;
    if (!byTarget.has(key)) {
      byTarget.set(key, []);
      order.push(key);
    }
    byTarget.get(key)!.push(node);
  }
  return order.map((targetAddress) => ({ targetAddress, nodes: byTarget.get(targetAddress)! }));
}

export interface PointerMapNodeFilter {
  targetAddress?: string | null;
  status?: PointerMapNodeStatus;
  module?: string;
  depth?: number;
}

export function filterPointerMapNodes(nodes: PointerMapNodeDto[], filter: PointerMapNodeFilter): PointerMapNodeDto[] {
  return nodes.filter((node) => {
    if (filter.targetAddress !== undefined && node.targetAddress !== filter.targetAddress) return false;
    if (filter.status !== undefined && node.status !== filter.status) return false;
    if (filter.module !== undefined && node.path.moduleName !== filter.module) return false;
    if (filter.depth !== undefined && node.depth !== filter.depth) return false;
    return true;
  });
}

export type PointerMapNodeSort = 'order' | 'depth' | 'module';

/** Stable sort — never mutates the input array. */
export function sortPointerMapNodes(nodes: PointerMapNodeDto[], sortBy: PointerMapNodeSort): PointerMapNodeDto[] {
  if (sortBy === 'order') return [...nodes];
  const sorted = [...nodes];
  if (sortBy === 'depth') {
    sorted.sort((a, b) => a.depth - b.depth);
  } else {
    sorted.sort((a, b) => a.path.moduleName.localeCompare(b.path.moduleName));
  }
  return sorted;
}

/** Distinct module names present in a map, in first-seen order — feeds the module filter dropdown. */
export function distinctModuleNames(nodes: PointerMapNodeDto[]): string[] {
  const seen = new Set<string>();
  const modules: string[] = [];
  for (const node of nodes) {
    if (!seen.has(node.path.moduleName)) {
      seen.add(node.path.moduleName);
      modules.push(node.path.moduleName);
    }
  }
  return modules;
}

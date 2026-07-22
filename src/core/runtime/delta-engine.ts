import type {
  HeadlessVerificationArtifact,
  HeadlessPointerVerificationResult,
} from './headless-verification.js';

export type SessionStabilityClassification =
  | 'l3_stability_verified'
  | 'executable_or_registry_changed'
  | 'missing'
  | 'not_l2_resolved'
  | 'signature_changed'
  | 'pointer_hops_changed'
  | 'module_relative_offset_changed'
  | 'resolved_region_changed'
  | 'inconsistent';

export interface SessionStabilityComparison {
  ctEntryId: string;
  label: string;
  classification: SessionStabilityClassification;
  previousStatus: HeadlessPointerVerificationResult['status'] | 'missing';
  currentStatus: HeadlessPointerVerificationResult['status'] | 'missing';
  previousFinalAddress: string | null;
  currentFinalAddress: string | null;
  previousPointerHops: number | null;
  currentPointerHops: number | null;
  previousSignatureId: string | null;
  currentSignatureId: string | null;
  previousModuleRelativeOffset: string | null;
  currentModuleRelativeOffset: string | null;
  reason: string;
}

export interface SessionStabilityArtifact {
  readOnly: true;
  executable: false;
  previousSessionId: string;
  currentSessionId: string;
  registryKey: string;
  promotedToL3: string[];
  unstableWarnings: string[];
  comparisons: SessionStabilityComparison[];
  summary: Record<SessionStabilityClassification, number>;
}

function emptySummary(): Record<SessionStabilityClassification, number> {
  return {
    l3_stability_verified: 0,
    executable_or_registry_changed: 0,
    missing: 0,
    not_l2_resolved: 0,
    signature_changed: 0,
    pointer_hops_changed: 0,
    module_relative_offset_changed: 0,
    resolved_region_changed: 0,
    inconsistent: 0,
  };
}

function byEntryId(results: HeadlessPointerVerificationResult[]): Map<string, HeadlessPointerVerificationResult> {
  return new Map(results.map((result) => [result.entryId, result]));
}

function registryKey(artifact: Pick<HeadlessVerificationArtifact, 'registrySource'>): string {
  return `${artifact.registrySource.game}:${artifact.registrySource.sha256}`;
}

function stableRecordFingerprint(record: Record<string, string | undefined>): string {
  return JSON.stringify(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function sessionId(artifact: HeadlessVerificationArtifact): string {
  return artifact.aobResolution.sessionId;
}

function linkedSignatureId(node: HeadlessPointerVerificationResult | undefined): string | null {
  return node?.linkedAobIds.slice().sort().join('|') || null;
}

function finalRegionClass(node: HeadlessPointerVerificationResult | undefined): string | null {
  if (!node) return null;
  if (node.status !== 'l2_resolved') return node.status;
  return 'committed_readable';
}

function parseHex(value: string | undefined): bigint | null {
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function normalizedModuleRelativeOffset(node: HeadlessPointerVerificationResult | undefined): string | null {
  const address = parseHex(node?.finalAddress);
  if (address === null) return null;

  const moduleName = node?.module;
  if (!moduleName) return null;
  const root = parseHex(node.rootOffset);
  if (root !== null && (node.hops?.length ?? 0) === 0) return `module:${moduleName.toLowerCase()}+0x${root.toString(16)}`;

  const lastHop = node.hops && node.hops.length > 0 ? node.hops[node.hops.length - 1] : undefined;
  const pointerValue = parseHex(lastHop?.pointerValue);
  const offset = parseHex(lastHop?.offset);
  if (pointerValue === null || offset === null) return null;
  const relative = address - pointerValue;
  return `heap-hop:${moduleName.toLowerCase()}+0x${relative.toString(16)}:${offset.toString(16)}`;
}

function classifyNode(input: {
  previous: HeadlessPointerVerificationResult | undefined;
  current: HeadlessPointerVerificationResult | undefined;
  forcedStale?: boolean;
}): Pick<SessionStabilityComparison, 'classification' | 'reason'> {
  if (input.forcedStale) {
    return {
      classification: 'executable_or_registry_changed',
      reason: 'Registry source or executable module hash changed; previous artifact cannot prove L3 stability.',
    };
  }
  if (!input.previous || !input.current) {
    return {
      classification: 'missing',
      reason: 'Pointer result was not present in both artifacts.',
    };
  }
  if (input.previous.status !== 'l2_resolved' || input.current.status !== 'l2_resolved') {
    return {
      classification: 'not_l2_resolved',
      reason: `L3 requires L2 resolution in both sessions; got ${input.previous.status} then ${input.current.status}.`,
    };
  }

  const previousSignatureId = linkedSignatureId(input.previous);
  const currentSignatureId = linkedSignatureId(input.current);
  if (previousSignatureId !== currentSignatureId) {
    return {
      classification: 'signature_changed',
      reason: 'Resolution anchor changed across artifacts.',
    };
  }

  if (input.previous.pointerChainLength !== input.current.pointerChainLength) {
    return {
      classification: 'pointer_hops_changed',
      reason: 'Pointer-chain hop count changed across artifacts.',
    };
  }

  if (normalizedModuleRelativeOffset(input.previous) !== normalizedModuleRelativeOffset(input.current)) {
    return {
      classification: 'module_relative_offset_changed',
      reason: 'Module-relative or hop-relative offset changed across artifacts.',
    };
  }

  if (finalRegionClass(input.previous) !== finalRegionClass(input.current)) {
    return {
      classification: 'resolved_region_changed',
      reason: 'Resolved memory region classification changed across artifacts.',
    };
  }

  return {
    classification: 'l3_stability_verified',
    reason: 'Pointer resolved through the same structural path and region class across sessions.',
  };
}

export function evaluateSessionStability(input: {
  baseline: HeadlessVerificationArtifact;
  current: HeadlessVerificationArtifact;
}): SessionStabilityArtifact {
  const previousById = byEntryId(input.baseline.pointerResults);
  const currentById = byEntryId(input.current.pointerResults);
  const allIds = [...new Set([...previousById.keys(), ...currentById.keys()])].sort();
  const forcedStale =
    registryKey(input.baseline) !== registryKey(input.current) ||
    stableRecordFingerprint(input.baseline.aobResolution.moduleHashes) !==
      stableRecordFingerprint(input.current.aobResolution.moduleHashes);

  const comparisons = allIds.map((ctEntryId): SessionStabilityComparison => {
    const previous = previousById.get(ctEntryId);
    const current = currentById.get(ctEntryId);
    const representative = current ?? previous;
    const classified = classifyNode({ previous, current, forcedStale });

    return {
      ctEntryId,
      label: representative?.label ?? ctEntryId,
      previousStatus: previous?.status ?? 'missing',
      currentStatus: current?.status ?? 'missing',
      previousFinalAddress: previous?.finalAddress ?? null,
      currentFinalAddress: current?.finalAddress ?? null,
      previousPointerHops: previous?.pointerChainLength ?? null,
      currentPointerHops: current?.pointerChainLength ?? null,
      previousSignatureId: linkedSignatureId(previous),
      currentSignatureId: linkedSignatureId(current),
      previousModuleRelativeOffset: normalizedModuleRelativeOffset(previous),
      currentModuleRelativeOffset: normalizedModuleRelativeOffset(current),
      ...classified,
    };
  });

  const summary = emptySummary();
  for (const comparison of comparisons) summary[comparison.classification] += 1;

  return {
    readOnly: true,
    executable: false,
    previousSessionId: sessionId(input.baseline),
    currentSessionId: sessionId(input.current),
    registryKey: registryKey(input.current),
    promotedToL3: comparisons
      .filter((comparison) => comparison.classification === 'l3_stability_verified')
      .map((comparison) => comparison.ctEntryId),
    unstableWarnings: comparisons
      .filter((comparison) => comparison.classification !== 'l3_stability_verified')
      .map((comparison) => comparison.ctEntryId),
    comparisons,
    summary,
  };
}

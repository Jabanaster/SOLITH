import type {
  RuntimeSignatureValidationArtifact,
  SignatureValidationResult,
} from './signature-validation.js';

export type RestartSignatureClassification =
  | 'restart_stable_unique'
  | 'hash_changed'
  | 'address_or_offset_changed'
  | 'not_unique'
  | 'missing'
  | 'not_tested'
  | 'inconsistent';

export interface RestartSignatureComparison {
  signatureId: string;
  symbol: string;
  module: string | null;
  classification: RestartSignatureClassification;
  previousStatus: SignatureValidationResult['status'];
  currentStatus: SignatureValidationResult['status'];
  previousAddress: string | null;
  currentAddress: string | null;
  previousOffset: number | null;
  currentOffset: number | null;
  previousModuleHash?: string;
  currentModuleHash?: string;
  certificationCandidate: 'L0' | 'L2' | 'L3';
  reason: string;
}

export interface RestartValidationArtifact {
  readOnly: true;
  executable: false;
  previousSessionId: string;
  currentSessionId: string;
  registryId: string;
  comparisons: RestartSignatureComparison[];
  summary: Record<RestartSignatureClassification, number>;
}

function bySignatureId(results: SignatureValidationResult[]): Map<string, SignatureValidationResult> {
  return new Map(results.map((result) => [result.signatureId, result]));
}

function firstMatch(result: SignatureValidationResult | undefined): { address: string | null; offset: number | null } {
  const match = result?.matches[0];
  return {
    address: match?.address ?? null,
    offset: match?.offset ?? null,
  };
}

function classify(input: {
  previous: SignatureValidationResult | undefined;
  current: SignatureValidationResult | undefined;
  previousModuleHash?: string;
  currentModuleHash?: string;
}): Pick<RestartSignatureComparison, 'classification' | 'certificationCandidate' | 'reason'> {
  const { previous, current } = input;
  if (!previous || !current) {
    return {
      classification: 'missing',
      certificationCandidate: 'L0',
      reason: 'Signature result was not present in both sessions.',
    };
  }
  if (previous.status === 'not_tested' || current.status === 'not_tested') {
    return {
      classification: 'not_tested',
      certificationCandidate: 'L0',
      reason: 'Signature was not tested in at least one session.',
    };
  }
  if (previous.status !== 'unique_match' || current.status !== 'unique_match') {
    return {
      classification: previous.status === 'module_missing' || current.status === 'module_missing' ? 'missing' : 'not_unique',
      certificationCandidate: 'L0',
      reason: `Restart evidence requires unique matches in both sessions; got ${previous.status} then ${current.status}.`,
    };
  }
  if (input.previousModuleHash && input.currentModuleHash && input.previousModuleHash !== input.currentModuleHash) {
    return {
      classification: 'hash_changed',
      certificationCandidate: 'L2',
      reason: 'Signature remained unique, but the module hash changed; keep below L3 for this build.',
    };
  }

  const previousMatch = firstMatch(previous);
  const currentMatch = firstMatch(current);
  if (previousMatch.offset !== currentMatch.offset) {
    return {
      classification: 'address_or_offset_changed',
      certificationCandidate: 'L2',
      reason: 'Signature remained unique, but the resolved module offset changed across restart.',
    };
  }

  return {
    classification: 'restart_stable_unique',
    certificationCandidate: 'L3',
    reason: 'Signature matched uniquely at the same module offset across restart with unchanged module hash evidence where provided.',
  };
}

export function compareRestartSignatureArtifacts(input: {
  previous: RuntimeSignatureValidationArtifact;
  current: RuntimeSignatureValidationArtifact;
}): RestartValidationArtifact {
  if (input.previous.registryId !== input.current.registryId) {
    throw new Error('Cannot compare restart artifacts from different registries.');
  }

  const previousById = bySignatureId(input.previous.signatureResults);
  const currentById = bySignatureId(input.current.signatureResults);
  const allIds = [...new Set([...previousById.keys(), ...currentById.keys()])].sort();

  const comparisons = allIds.map((signatureId): RestartSignatureComparison => {
    const previous = previousById.get(signatureId);
    const current = currentById.get(signatureId);
    const representative = current ?? previous;
    const previousMatch = firstMatch(previous);
    const currentMatch = firstMatch(current);
    const module = representative?.module ?? null;
    const previousModuleHash = module ? input.previous.moduleHashes[module] : undefined;
    const currentModuleHash = module ? input.current.moduleHashes[module] : undefined;
    const classified = classify({ previous, current, previousModuleHash, currentModuleHash });

    return {
      signatureId,
      symbol: representative?.symbol ?? signatureId,
      module,
      previousStatus: previous?.status ?? 'not_tested',
      currentStatus: current?.status ?? 'not_tested',
      previousAddress: previousMatch.address,
      currentAddress: currentMatch.address,
      previousOffset: previousMatch.offset,
      currentOffset: currentMatch.offset,
      previousModuleHash,
      currentModuleHash,
      ...classified,
    };
  });

  const summary = Object.fromEntries(
    ([
      'restart_stable_unique',
      'hash_changed',
      'address_or_offset_changed',
      'not_unique',
      'missing',
      'not_tested',
      'inconsistent',
    ] as RestartSignatureClassification[]).map((classification) => [
      classification,
      comparisons.filter((comparison) => comparison.classification === classification).length,
    ]),
  ) as Record<RestartSignatureClassification, number>;

  return {
    readOnly: true,
    executable: false,
    previousSessionId: input.previous.sessionId,
    currentSessionId: input.current.sessionId,
    registryId: input.current.registryId,
    comparisons,
    summary,
  };
}

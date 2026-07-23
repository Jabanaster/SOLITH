import type { RegistryAobSignature } from '../registry/compile-ct-registry.js';
import type { CompiledCtRegistry } from '../registry/loaded-registry.js';
import type { RuntimeModuleInfo } from './module-inspection.js';
import { findModule } from './module-inspection.js';
import type { ReadOnlyMemoryReader } from './memory-reader.js';
import { DEFAULT_RUNTIME_POLICY, assertReadOnlyPolicy, type RuntimePolicy } from './runtime-policy.js';
import type { SignatureResolutionArtifact } from './signature-resolution.js';
import { scanModuleForSignature } from './signature-scanner.js';
import type { SignatureValidationResult, SignatureValidationStatus } from './signature-validation.js';

export type AobRepairCandidateStatus =
  | 'candidate_unique_match'
  | 'candidate_multiple_matches'
  | 'candidate_no_match'
  | 'candidate_read_failure'
  | 'skipped';

export interface AobRepairCandidate {
  pattern: string;
  strategy: string;
  wildcardedIndexes: number[];
  status: AobRepairCandidateStatus;
  matchCount: number;
  matches: Array<{ offset: number; address: string }>;
  warning?: string;
  error?: string;
}

export interface AobRepairSignatureReport {
  signatureId: string;
  symbol: string;
  module: string | null;
  originalPattern: string;
  originalStatus: SignatureValidationStatus | 'missing_artifact_result';
  candidates: AobRepairCandidate[];
  recommendation:
    | 'replace_candidate_requires_restart_validation'
    | 'needs_manual_wingdk_research'
    | 'not_eligible'
    | 'already_resolves';
  warnings: string[];
}

export interface AobRepairAnalysisReport {
  schemaVersion: '1.0.0';
  generatedAt: string;
  registryId: string;
  sourceSessionId: string;
  readOnly: true;
  executable: false;
  policy: {
    maxCandidatesPerSignature: number;
    sourceStatuses: string[];
  };
  totals: {
    inspected: number;
    alreadyResolving: number;
    skipped: number;
    candidatesGenerated: number;
    uniqueCandidates: number;
    multipleCandidates: number;
    noMatchCandidates: number;
    readFailures: number;
  };
  signatures: AobRepairSignatureReport[];
}

export interface AnalyzeAobRepairCandidatesInput {
  registry: CompiledCtRegistry;
  sourceArtifact: SignatureResolutionArtifact;
  modules: RuntimeModuleInfo[];
  reader: ReadOnlyMemoryReader;
  generatedAt?: string;
  maxCandidatesPerSignature?: number;
  maxObservedRefinementsPerCandidate?: number;
  sourceStatuses?: SignatureValidationStatus[];
  symbols?: string[];
  policy?: RuntimePolicy;
}

const DEFAULT_SOURCE_STATUSES: SignatureValidationStatus[] = ['no_match'];
const DEFAULT_MAX_CANDIDATES_PER_SIGNATURE = 8;
const DEFAULT_MAX_OBSERVED_REFINEMENTS_PER_CANDIDATE = 3;

function signatureResultById(
  artifact: SignatureResolutionArtifact,
): Map<string, SignatureValidationResult> {
  return new Map(artifact.signatureResults.map((result) => [result.signatureId, result]));
}

function normalizeTokens(pattern: string): string[] {
  return pattern.trim().split(/\s+/).filter(Boolean).map((token) => {
    if (/^[0-9A-Fa-f]{2}$/.test(token)) return token.toUpperCase();
    if (/^\?+$/.test(token)) return '??';
    if (/^\*+$/.test(token)) return '*';
    return token;
  });
}

function isConcreteByte(token: string): boolean {
  return /^[0-9A-F]{2}$/.test(token);
}

function uniquePatternKey(tokens: string[]): string {
  return tokens.join(' ');
}

function pushCandidate(
  candidates: Array<{ pattern: string; strategy: string; wildcardedIndexes: number[] }>,
  seen: Set<string>,
  tokens: string[],
  strategy: string,
  wildcardedIndexes: number[],
  maxCandidates: number,
): void {
  if (candidates.length >= maxCandidates) return;
  const candidateTokens = [...tokens];
  for (const index of wildcardedIndexes) {
    if (index >= 0 && index < candidateTokens.length && isConcreteByte(candidateTokens[index])) {
      candidateTokens[index] = '??';
    }
  }
  const key = uniquePatternKey(candidateTokens);
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ pattern: key, strategy, wildcardedIndexes });
}

export function generateConservativeAobRepairPatterns(
  signature: Pick<RegistryAobSignature, 'normalizedPattern'>,
  options: { maxCandidates?: number } = {},
): Array<{ pattern: string; strategy: string; wildcardedIndexes: number[] }> {
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES_PER_SIGNATURE;
  const tokens = normalizeTokens(signature.normalizedPattern);
  const concreteIndexes = tokens
    .map((token, index) => (isConcreteByte(token) ? index : -1))
    .filter((index) => index >= 0);
  const candidates: Array<{ pattern: string; strategy: string; wildcardedIndexes: number[] }> = [];
  const seen = new Set<string>([uniquePatternKey(tokens)]);

  if (maxCandidates <= 0 || concreteIndexes.length === 0) return candidates;

  const center = Math.floor(tokens.length / 2);
  const priorityIndexes = [...concreteIndexes].sort((a, b) => {
    const distance = Math.abs(a - center) - Math.abs(b - center);
    return distance === 0 ? a - b : distance;
  });

  for (const index of priorityIndexes) {
    pushCandidate(candidates, seen, tokens, 'wildcard-single-byte', [index], maxCandidates);
  }

  for (const index of priorityIndexes) {
    if (candidates.length >= maxCandidates) break;
    pushCandidate(candidates, seen, tokens, 'wildcard-adjacent-pair', [index, index + 1], maxCandidates);
  }

  for (const index of priorityIndexes) {
    if (candidates.length >= maxCandidates) break;
    pushCandidate(candidates, seen, tokens, 'wildcard-neighbor-pair', [index - 1, index + 1], maxCandidates);
  }

  return candidates;
}

function statusForCandidateMatchCount(matchCount: number): AobRepairCandidateStatus {
  if (matchCount === 0) return 'candidate_no_match';
  if (matchCount === 1) return 'candidate_unique_match';
  return 'candidate_multiple_matches';
}

async function refineMultipleCandidateFromObservedBytes(input: {
  candidate: AobRepairCandidate;
  module: RuntimeModuleInfo;
  reader: ReadOnlyMemoryReader;
  policy: RuntimePolicy;
  maxRefinements: number;
}): Promise<AobRepairCandidate[]> {
  if (input.candidate.status !== 'candidate_multiple_matches') return [];
  const tokenCount = normalizeTokens(input.candidate.pattern).length;
  const refinements: AobRepairCandidate[] = [];
  const seen = new Set<string>();

  for (const match of input.candidate.matches.slice(0, input.maxRefinements)) {
    try {
      const bytes = await input.reader.readModuleBytes(input.module, match.offset, tokenCount);
      const observedPattern = [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');

      if (seen.has(observedPattern)) continue;
      seen.add(observedPattern);

      const scan = await scanModuleForSignature({
        module: input.module,
        pattern: observedPattern,
        reader: input.reader,
        policy: input.policy,
      });

      refinements.push({
        pattern: observedPattern,
        strategy: `observed-exact-from-${input.candidate.strategy}`,
        wildcardedIndexes: [],
        status: statusForCandidateMatchCount(scan.matches.length),
        matchCount: scan.matches.length,
        matches: scan.matches,
        warning: scan.truncated ? 'Module scan was bounded by runtime policy maxScanBytes.' : undefined,
      });
    } catch (error) {
      refinements.push({
        pattern: input.candidate.pattern,
        strategy: `observed-exact-from-${input.candidate.strategy}`,
        wildcardedIndexes: [],
        status: 'candidate_read_failure',
        matchCount: 0,
        matches: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return refinements;
}

function recommendationForCandidates(
  originalStatus: AobRepairSignatureReport['originalStatus'],
  candidates: AobRepairCandidate[],
): AobRepairSignatureReport['recommendation'] {
  if (originalStatus === 'unique_match' || originalStatus === 'multiple_matches') return 'already_resolves';
  if (candidates.some((candidate) => candidate.status === 'candidate_unique_match')) {
    return 'replace_candidate_requires_restart_validation';
  }
  if (candidates.length === 0 || candidates.every((candidate) => candidate.status === 'skipped')) {
    return 'not_eligible';
  }
  return 'needs_manual_wingdk_research';
}

export async function analyzeAobRepairCandidatesReadOnly(
  input: AnalyzeAobRepairCandidatesInput,
): Promise<AobRepairAnalysisReport> {
  const policy = input.policy ?? DEFAULT_RUNTIME_POLICY;
  assertReadOnlyPolicy(policy);
  const maxCandidatesPerSignature =
    input.maxCandidatesPerSignature ?? DEFAULT_MAX_CANDIDATES_PER_SIGNATURE;
  const maxObservedRefinementsPerCandidate =
    input.maxObservedRefinementsPerCandidate ?? DEFAULT_MAX_OBSERVED_REFINEMENTS_PER_CANDIDATE;
  const sourceStatuses = input.sourceStatuses ?? DEFAULT_SOURCE_STATUSES;
  const sourceStatusSet = new Set<SignatureValidationStatus>(sourceStatuses);
  const symbolSet = input.symbols ? new Set(input.symbols.map((symbol) => symbol.toLowerCase())) : null;
  const artifactResults = signatureResultById(input.sourceArtifact);

  const reports: AobRepairSignatureReport[] = [];

  for (const signature of input.registry.aobSignatures) {
    if (symbolSet && !symbolSet.has(signature.symbol.toLowerCase())) continue;

    const artifactResult = artifactResults.get(signature.id);
    const originalStatus = artifactResult?.status ?? 'missing_artifact_result';
    const warnings: string[] = [];
    const candidates: AobRepairCandidate[] = [];

    if (!artifactResult) {
      warnings.push('Signature was not present in the source validation artifact.');
    }

    if (!signature.module) {
      warnings.push('Module-less signatures require an explicit scan region and are not repair-scanned.');
    }

    if (artifactResult && !sourceStatusSet.has(artifactResult.status)) {
      reports.push({
        signatureId: signature.id,
        symbol: signature.symbol,
        module: signature.module,
        originalPattern: signature.normalizedPattern,
        originalStatus,
        candidates,
        recommendation: recommendationForCandidates(originalStatus, candidates),
        warnings,
      });
      continue;
    }

    const module = signature.module ? findModule(input.modules, signature.module) : null;
    if (!module) {
      warnings.push(signature.module ? `Module not loaded: ${signature.module}` : 'Missing module target.');
      candidates.push({
        pattern: signature.normalizedPattern,
        strategy: 'module-unavailable',
        wildcardedIndexes: [],
        status: 'skipped',
        matchCount: 0,
        matches: [],
        warning: warnings[warnings.length - 1],
      });
      reports.push({
        signatureId: signature.id,
        symbol: signature.symbol,
        module: signature.module,
        originalPattern: signature.normalizedPattern,
        originalStatus,
        candidates,
        recommendation: recommendationForCandidates(originalStatus, candidates),
        warnings,
      });
      continue;
    }

    const generated = generateConservativeAobRepairPatterns(signature, {
      maxCandidates: maxCandidatesPerSignature,
    });

    if (generated.length === 0) {
      warnings.push('No conservative repair candidates could be generated from this pattern.');
    }

    for (const candidate of generated) {
      try {
        const scan = await scanModuleForSignature({
          module,
          pattern: candidate.pattern,
          reader: input.reader,
          policy,
        });
        candidates.push({
          ...candidate,
          status: statusForCandidateMatchCount(scan.matches.length),
          matchCount: scan.matches.length,
          matches: scan.matches,
          warning: scan.truncated ? 'Module scan was bounded by runtime policy maxScanBytes.' : undefined,
        });
        const latest = candidates[candidates.length - 1];
        candidates.push(...await refineMultipleCandidateFromObservedBytes({
          candidate: latest,
          module,
          reader: input.reader,
          policy,
          maxRefinements: maxObservedRefinementsPerCandidate,
        }));
      } catch (error) {
        candidates.push({
          ...candidate,
          status: 'candidate_read_failure',
          matchCount: 0,
          matches: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    reports.push({
      signatureId: signature.id,
      symbol: signature.symbol,
      module: signature.module,
      originalPattern: signature.normalizedPattern,
      originalStatus,
      candidates,
      recommendation: recommendationForCandidates(originalStatus, candidates),
      warnings,
    });
  }

  const allCandidates = reports.flatMap((report) => report.candidates);

  return {
    schemaVersion: '1.0.0',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    registryId: input.sourceArtifact.registryId,
    sourceSessionId: input.sourceArtifact.sessionId,
    readOnly: true,
    executable: false,
    policy: {
      maxCandidatesPerSignature,
      sourceStatuses,
    },
    totals: {
      inspected: reports.length,
      alreadyResolving: reports.filter((report) => report.recommendation === 'already_resolves').length,
      skipped: allCandidates.filter((candidate) => candidate.status === 'skipped').length,
      candidatesGenerated: allCandidates.length,
      uniqueCandidates: allCandidates.filter((candidate) => candidate.status === 'candidate_unique_match').length,
      multipleCandidates: allCandidates.filter((candidate) => candidate.status === 'candidate_multiple_matches').length,
      noMatchCandidates: allCandidates.filter((candidate) => candidate.status === 'candidate_no_match').length,
      readFailures: allCandidates.filter((candidate) => candidate.status === 'candidate_read_failure').length,
    },
    signatures: reports,
  };
}

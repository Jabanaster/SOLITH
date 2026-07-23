import type { RuntimeProcessSummary } from '../runtime/process-discovery.js';
import type { CertificationLevel, SolithDefinitionV1, SolithTargetMetadataV1 } from './schema.v1.js';

export type TargetSelectionStatus =
  | 'matched'
  | 'hash_mismatch'
  | 'restricted_fail_closed'
  | 'protected_fail_closed'
  | 'missing_target_metadata';

export interface TargetSelectionResult {
  status: TargetSelectionStatus;
  target: SolithTargetMetadataV1 | null;
  certificationLevel: CertificationLevel;
  reason: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function hashMatches(target: SolithTargetMetadataV1, executableSha256?: string): boolean {
  if (!target.executableSha256 && !target.executableHashPrefixes?.length) return true;
  if (!executableSha256) return false;
  const normalizedHash = normalize(executableSha256);
  return (
    normalize(target.executableSha256 ?? '') === normalizedHash ||
    Boolean(target.executableHashPrefixes?.some((prefix) => normalizedHash.startsWith(normalize(prefix))))
  );
}

export function definitionTargetMetadata(definition: SolithDefinitionV1): SolithTargetMetadataV1[] {
  if (definition.targetMetadata?.length) return definition.targetMetadata;
  return definition.target.executables.map((executableName) => ({
    targetId: `${definition.id}:${executableName}`,
    launcher: 'unknown',
    executableName,
    executableSha256: definition.targetSHA256,
    executableHashPrefixes: definition.executableHashPrefixes,
    moduleName: executableName,
    packaging: 'unknown',
    accessModel: 'standard_user_readonly',
    certificationLevel: definition.certificationLevel ?? 'L0',
  }));
}

export function selectDefinitionTarget(
  definition: SolithDefinitionV1,
  process: Pick<RuntimeProcessSummary, 'executableName'>,
  executableSha256?: string,
): TargetSelectionResult {
  const candidates = definitionTargetMetadata(definition).filter(
    (target) => normalize(target.executableName) === normalize(process.executableName),
  );

  if (candidates.length === 0) {
    return {
      status: 'missing_target_metadata',
      target: null,
      certificationLevel: 'L0',
      reason: `No target metadata matches executable ${process.executableName}.`,
    };
  }

  const target = candidates.find((candidate) => hashMatches(candidate, executableSha256)) ?? candidates[0]!;
  if (!hashMatches(target, executableSha256)) {
    return {
      status: 'hash_mismatch',
      target,
      certificationLevel: 'L0',
      reason: `Executable hash does not match target ${target.targetId}; prior certification does not apply.`,
    };
  }

  if (target.accessModel === 'protected_target_blocked') {
    return {
      status: 'protected_fail_closed',
      target,
      certificationLevel: 'L0',
      reason: `Target ${target.targetId} is marked protected; Solith must fail closed.`,
    };
  }

  if (target.accessModel === 'restricted_or_denied') {
    return {
      status: 'restricted_fail_closed',
      target,
      certificationLevel: 'L0',
      reason:
        `Target ${target.targetId} is launcher/package restricted. ` +
        'If normal read/query access is denied, Solith reports unavailable instead of requesting elevation.',
    };
  }

  return {
    status: 'matched',
    target,
    certificationLevel: target.certificationLevel ?? 'L0',
    reason: `Target ${target.targetId} matched with per-target certification ${target.certificationLevel ?? 'L0'}.`,
  };
}

import { REGISTRY_SCHEMA_VERSION, type VersionedRegistryArtifact } from './schema.js';

export interface RegistryValidationResult {
  ok: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string, errors: string[], path: string): void {
  if (typeof record[field] !== 'string' || !record[field]) errors.push(`${path}.${field} must be a non-empty string.`);
}

function requireNumber(record: Record<string, unknown>, field: string, errors: string[], path: string): void {
  if (typeof record[field] !== 'number' || !Number.isFinite(record[field])) {
    errors.push(`${path}.${field} must be a finite number.`);
  }
}

function requireArray(record: Record<string, unknown>, field: string, errors: string[], path: string): void {
  if (!Array.isArray(record[field])) errors.push(`${path}.${field} must be an array.`);
}

export function validateRegistryArtifact(value: unknown): RegistryValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['Registry artifact must be an object.'] };

  if (value.schemaVersion !== '1.0.0') {
    errors.push(`schemaVersion must be "1.0.0"; got ${String(value.schemaVersion ?? 'missing')}.`);
  }

  if (!isRecord(value.artifact)) {
    errors.push('artifact metadata is required.');
  } else {
    if (value.artifact.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
      errors.push(`artifact.schemaVersion must be ${REGISTRY_SCHEMA_VERSION}; got ${String(value.artifact.schemaVersion ?? 'missing')}.`);
    }
    requireString(value.artifact, 'generatedAt', errors, 'artifact');

    if (!isRecord(value.artifact.source)) {
      errors.push('artifact.source is required.');
    } else {
      requireString(value.artifact.source, 'path', errors, 'artifact.source');
      requireString(value.artifact.source, 'filename', errors, 'artifact.source');
      requireString(value.artifact.source, 'sha256', errors, 'artifact.source');
      if (
        typeof value.artifact.source.sha256 === 'string' &&
        !/^[a-f0-9]{64}$/i.test(value.artifact.source.sha256)
      ) {
        errors.push('artifact.source.sha256 must be a 64-character SHA-256 hex digest.');
      }
    }

    if (!isRecord(value.artifact.counts)) {
      errors.push('artifact.counts is required.');
    } else {
      for (const field of ['pointers', 'scripts', 'aobSignatures', 'rejections', 'warnings', 'duplicates']) {
        requireNumber(value.artifact.counts, field, errors, 'artifact.counts');
      }
    }
  }

  for (const field of ['game', 'sourceFile', 'compiledAt']) requireString(value, field, errors, 'registry');
  if (!isRecord(value.metadata)) errors.push('metadata is required.');
  if (!isRecord(value.pointers)) {
    errors.push('pointers is required.');
  } else {
    requireArray(value.pointers, 'accepted', errors, 'pointers');
    requireArray(value.pointers, 'rejected', errors, 'pointers');
  }
  if (!isRecord(value.scripts)) {
    errors.push('scripts is required.');
  } else {
    requireArray(value.scripts, 'scripts', errors, 'scripts');
  }
  requireArray(value, 'aobSignatures', errors, 'registry');
  requireArray(value, 'rejections', errors, 'registry');

  if (Array.isArray(value.aobSignatures)) {
    value.aobSignatures.forEach((signature, index) => {
      if (!isRecord(signature)) {
        errors.push(`aobSignatures[${index}] must be an object.`);
        return;
      }
      for (const field of ['id', 'symbol', 'scanType', 'pattern', 'normalizedPattern', 'sourceEntryDescription']) {
        requireString(signature, field, errors, `aobSignatures[${index}]`);
      }
      if (signature.executable !== false) errors.push(`aobSignatures[${index}].executable must be false.`);
      if (!Array.isArray(signature.warnings)) errors.push(`aobSignatures[${index}].warnings must be an array.`);
    });
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidRegistryArtifact(value: unknown): asserts value is VersionedRegistryArtifact {
  const result = validateRegistryArtifact(value);
  if (!result.ok) throw new Error(`Invalid registry artifact: ${result.errors.join(' ')}`);
}

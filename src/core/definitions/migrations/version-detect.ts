import { SUPPORTED_TRAINER_SCHEMA_VERSIONS } from './types.js';

export type DetectedVersion =
  | { kind: 'legacy_unversioned' }
  | { kind: 'versioned'; version: number }
  | { kind: 'unknown_future_version'; version: number }
  | { kind: 'malformed'; reason: string };

/**
 * First stage of the canonical version pipeline (RawInput → Version
 * Detection → ...). Never validates the rest of the object's shape — only
 * decides which of three lanes the input belongs in: unversioned/legacy,
 * a supported version, or something this build cannot safely interpret.
 * Everything downstream must fail closed on the last two malformed/unknown
 * cases rather than guessing.
 */
export function detectTrainerDefinitionVersion(input: unknown): DetectedVersion {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { kind: 'malformed', reason: 'Trainer definition input must be a non-null object.' };
  }

  const record = input as Record<string, unknown>;
  if (!('schemaVersion' in record) || record.schemaVersion === undefined) {
    return { kind: 'legacy_unversioned' };
  }

  const raw = record.schemaVersion;
  let numeric: number | null = null;
  if (typeof raw === 'number') {
    numeric = raw;
  } else if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    numeric = Number(raw);
  }

  if (numeric === null || !Number.isInteger(numeric) || numeric < 0) {
    return {
      kind: 'malformed',
      reason: `schemaVersion must be a non-negative integer (or absent for legacy input); got ${JSON.stringify(raw)}.`,
    };
  }

  if ((SUPPORTED_TRAINER_SCHEMA_VERSIONS as readonly number[]).includes(numeric)) {
    return { kind: 'versioned', version: numeric };
  }

  return { kind: 'unknown_future_version', version: numeric };
}

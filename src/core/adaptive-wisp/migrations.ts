import { WISP_PROFILE_SCHEMA_VERSION } from './schema.js';

/**
 * Adaptive Wisp schema migration foundation (Increment 1, Section 17).
 *
 * No migration is needed yet — schema version 1 is the only version that
 * has ever existed. This module exists so a future v2 has somewhere to land
 * without inventing an ad-hoc JSON-patching path at that point.
 */
export interface WispProfileMigration {
  from: number;
  to: number;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

export const WISP_PROFILE_MIGRATIONS: readonly WispProfileMigration[] = [];

/**
 * Walks `raw` from `fromVersion` to WISP_PROFILE_SCHEMA_VERSION via the
 * registered migration chain. Never mutates `raw` — each migration step (once
 * any exist) is responsible for returning a new object, and the identity
 * case (fromVersion already current) returns the same reference untouched.
 *
 * Callers must have already confirmed `fromVersion` is in
 * WISP_SUPPORTED_PROFILE_SCHEMA_VERSIONS (see validation.ts) — an
 * unreachable version here is a programmer error, not untrusted input.
 */
export function migrateWispProfileToCurrentVersion(raw: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = raw;
  let version = fromVersion;
  while (version !== WISP_PROFILE_SCHEMA_VERSION) {
    const step = WISP_PROFILE_MIGRATIONS.find((m) => m.from === version);
    if (!step) {
      throw new Error(`adaptive-wisp: no migration path registered from schema version ${version}`);
    }
    current = step.migrate(current);
    version = step.to;
  }
  return current;
}

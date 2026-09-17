import type { ModPack } from '../../trainer-catalog/types.js';
import { modPackToSolithDefinition } from '../mod-pack-adapter.js';
import type { SolithDefinitionV1 } from '../schema.v1.js';

const VERIFICATION_STATUSES = new Set(['verified', 'community', 'metadata-only', 'unverified']);

/**
 * Structural pre-check only — deliberately not a full ModPack Zod schema.
 * Just enough to make `modPackToSolithDefinition`'s field access fail
 * closed with a typed error instead of an uncaught TypeError, for input
 * that isn't shaped like a legacy ModPack at all (mission requirement:
 * "malformed legacy input remains rejected").
 */
function checkLegacyModPackShape(input: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof input.catalogGameId !== 'string' || !input.catalogGameId) {
    errors.push('legacy input missing required string field "catalogGameId".');
  }
  if (typeof input.gameName !== 'string' || !input.gameName) {
    errors.push('legacy input missing required string field "gameName".');
  }
  if (!input.source || typeof input.source !== 'object' || typeof (input.source as Record<string, unknown>).provider !== 'string') {
    errors.push('legacy input missing required object field "source.provider".');
  }
  if (typeof input.verificationStatus !== 'string' || !VERIFICATION_STATUSES.has(input.verificationStatus)) {
    errors.push('legacy input missing/invalid "verificationStatus".');
  }
  if (!Array.isArray(input.versions)) {
    errors.push('legacy input missing required array field "versions".');
  }
  if (!Array.isArray(input.cheats)) {
    errors.push('legacy input missing required array field "cheats".');
  }
  return errors;
}

export type LegacyMigrationOutcome =
  | { success: true; definition: SolithDefinitionV1; warnings: string[] }
  | { success: false; errors: string[] };

/**
 * LEGACY_UNVERSIONED → V1. Formalizes the behavior previously buried in
 * mod-pack-adapter.ts's doc comment ("mod packs without schemaVersion are
 * treated as v0 and adapted at runtime") as an explicit, tested migration
 * step. Does not mutate `input`.
 */
export function migrateLegacyUnversionedToV1(input: unknown): LegacyMigrationOutcome {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, errors: ['Legacy input must be a non-null object.'] };
  }

  const record = input as Record<string, unknown>;
  const shapeErrors = checkLegacyModPackShape(record);
  if (shapeErrors.length > 0) {
    return { success: false, errors: shapeErrors };
  }

  const definition = modPackToSolithDefinition(record as unknown as ModPack);
  return { success: true, definition, warnings: [] };
}

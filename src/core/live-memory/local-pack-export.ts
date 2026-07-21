/**
 * Phase 4 — local portable pack / shard export (air-gap friendly).
 * No cloud handshake; caller writes the JSON where they choose.
 */

import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import type { CtPromoteCandidate } from './ct-promote.js';

export const LOCAL_PACK_SCHEMA_VERSION = 1 as const;

export interface LocalTrainerPack {
  schemaVersion: typeof LOCAL_PACK_SCHEMA_VERSION;
  exportedAt: string;
  catalogGameId: string;
  title: string;
  /** Optional definition fragment (L0 community). */
  definition?: SolithDefinitionV1;
  /** Validated / promoted pointer mappings. */
  mappings: CtPromoteCandidate[];
  notes?: string;
  /** Explicit air-gap marker — packs never require hub login. */
  airGap: {
    requiresLogin: false;
    requiresCloudAllowList: false;
    hubSyncOptional: true;
  };
}

export function buildLocalTrainerPack(input: {
  catalogGameId: string;
  title: string;
  mappings: CtPromoteCandidate[];
  definition?: SolithDefinitionV1;
  notes?: string;
  exportedAt?: string;
}): LocalTrainerPack {
  return {
    schemaVersion: LOCAL_PACK_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    catalogGameId: input.catalogGameId,
    title: input.title,
    definition: input.definition,
    mappings: input.mappings.filter((m) => m.liveResolution === 'resolvable'),
    notes: input.notes,
    airGap: {
      requiresLogin: false,
      requiresCloudAllowList: false,
      hubSyncOptional: true,
    },
  };
}

export function serializeLocalTrainerPack(pack: LocalTrainerPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function parseLocalTrainerPack(json: string): LocalTrainerPack {
  const raw = JSON.parse(json) as LocalTrainerPack;
  if (raw?.schemaVersion !== 1) {
    throw new Error('unsupported_local_pack_schema');
  }
  if (!raw.catalogGameId || !Array.isArray(raw.mappings)) {
    throw new Error('invalid_local_pack');
  }
  return {
    ...raw,
    airGap: {
      requiresLogin: false,
      requiresCloudAllowList: false,
      hubSyncOptional: true,
    },
  };
}

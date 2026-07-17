import { z } from 'zod';
import db from '../../database/index.js';
import { SolithDefinitionV1Schema, type SolithDefinitionV1 } from '../../definitions/schema.v1.js';
import { getSetting } from '../../settings/index.js';
import {
  getCatalogEntry,
  getMaxHubDefinitionUpdatedAt,
  hasUserAuthoredDefinition,
  logTrainerSync,
  upsertCatalogEntry,
  upsertDefinitionPayload,
  type HubCertificationLevel,
} from '../store.js';
import { buildSearchableText } from '../types.js';

export const SOLITH_HUB_BASE_URL = 'https://solith-hub-backend.jabanaster.workers.dev';
const MAX_SYNC_PAGES = 100;
const MAX_SYNC_RESPONSE_BYTES = 32 * 1024 * 1024;
const SYNC_TIMEOUT_MS = 15_000;
const MAX_DEFINITION_BYTES = 256 * 1024;

const HubDefinitionSchema = z.object({
  id: z.string().min(1).max(128),
  game_id: z.string().min(1).max(128),
  executable_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  cert_level: z.enum(['L0_Community', 'L3_Certified']),
  definition_payload: z.unknown(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

const HubSyncResponseSchema = z.object({
  definitions: z.array(HubDefinitionSchema).max(100),
  count: z.number().int().nonnegative(),
  next_since: z.string().datetime({ offset: true }),
  has_more: z.boolean(),
});

const HubSubmissionResponseSchema = z.object({
  id: z.string().min(1),
  game_id: z.string().min(1),
  cert_level: z.literal('L0_Community'),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export interface CommunitySyncResult {
  status: 'disabled' | 'synced';
  imported: number;
  skippedUserDefinitions: number;
  rejected: number;
  pages: number;
  maxLocalTimestamp: number;
}

export interface CommunitySyncOptions {
  fetchImpl?: typeof fetch;
  overwriteUserDefinitions?: boolean;
}

export interface CommunityPublishResult {
  id: string;
  gameId: string;
  certLevel: 'L0_Community';
  createdAt: string;
  updatedAt: string;
}

function redactPii(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/[A-Za-z]:\\Users\\[^\\/"']+/gi, '%USERPROFILE%')
      .replace(/\\\\[^\\/"']+\\Users\\[^\\/"']+/gi, '%USERPROFILE%')
      .replace(/\\\\wsl\$\\[^\\/"']+/gi, '$WSL_HOME')
      .replace(/\/\/wsl\$\/[^/"']+/gi, '$WSL_HOME')
      .replace(/\/(?:Users|home)\/[^/"]+/gi, '$HOME');
  }
  if (Array.isArray(value)) return value.map(redactPii);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      redactPii(nested),
    ]),
  );
}

function executableBasename(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

export function sanitizeDefinitionForCommunityPublish(
  input: SolithDefinitionV1,
  executableHash: string,
): SolithDefinitionV1 {
  const parsed = SolithDefinitionV1Schema.parse(redactPii(input));
  const sanitized: SolithDefinitionV1 = {
    ...parsed,
    author: 'community-contributor',
    targetSHA256: executableHash.toLowerCase(),
    safety: {
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: 'community',
    },
    target: {
      ...parsed.target,
      executables: parsed.target.executables.map(executableBasename),
    },
    memoryFeatures: parsed.memoryFeatures?.map((feature) => ({
      ...feature,
      certificationLevel: undefined,
      resolution: {
        ...feature.resolution,
        moduleName: executableBasename(feature.resolution.moduleName),
      },
    })),
    certificationLevel: undefined,
  };
  return SolithDefinitionV1Schema.parse(sanitized);
}

export async function publishCommunityDefinition(
  input: {
    definition: SolithDefinitionV1;
    executableHash: string;
  },
  options: { fetchImpl?: typeof fetch } = {},
): Promise<CommunityPublishResult> {
  if (getSetting('communitySyncEnabled') !== true) {
    throw new Error('community_sync_disabled');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.executableHash)) {
    throw new Error('Executable hash must be a full SHA-256 value');
  }

  const definition = sanitizeDefinitionForCommunityPublish(
    input.definition,
    input.executableHash,
  );
  const body = JSON.stringify({
    game_id: definition.id,
    executable_hash: input.executableHash.toLowerCase(),
    definition_payload: definition,
  });
  if (new TextEncoder().encode(body).byteLength > MAX_DEFINITION_BYTES) {
    throw new Error('Community definition exceeds the 256 KiB limit');
  }

  const response = await (options.fetchImpl ?? globalThis.fetch)(
    new URL('/submit', SOLITH_HUB_BASE_URL),
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`Solith Hub publish failed with HTTP ${response.status}`);
  }
  const rawText = await response.text();
  if (new TextEncoder().encode(rawText).byteLength > MAX_DEFINITION_BYTES) {
    throw new Error('Solith Hub publish response exceeded the size limit');
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error('Solith Hub publish returned invalid JSON');
  }
  const result = HubSubmissionResponseSchema.parse(parsedJson);
  return {
    id: result.id,
    gameId: result.game_id,
    certLevel: result.cert_level,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
}

function trustHubCertification(
  input: unknown,
  certLevel: HubCertificationLevel,
  executableHash: string,
): SolithDefinitionV1 {
  const source = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {};
  const safety = source.safety && typeof source.safety === 'object'
    ? source.safety as Record<string, unknown>
    : {};

  // Hub payloads are untrusted over the network: never honor remote claims that
  // disable approval/offline confirm, even for L3_Certified records.
  const normalized: Record<string, unknown> = {
    ...source,
    targetSHA256: executableHash.toLowerCase(),
    safety: {
      ...safety,
      requiresApproval: true,
      requiresOfflineConfirm: true,
      verificationStatus: certLevel === 'L3_Certified' ? 'verified' : 'community',
    },
  };

  if (certLevel === 'L3_Certified') {
    normalized.certificationLevel = 'L3';
  } else {
    delete normalized.certificationLevel;
    if (Array.isArray(normalized.memoryFeatures)) {
      normalized.memoryFeatures = normalized.memoryFeatures.map((feature) => {
        if (!feature || typeof feature !== 'object') return feature;
        const copy = { ...(feature as Record<string, unknown>) };
        delete copy.certificationLevel;
        return copy;
      });
    }
  }

  return SolithDefinitionV1Schema.parse(normalized);
}

function cheatCount(definition: SolithDefinitionV1): number {
  return (definition.memoryFeatures?.length ?? 0) +
    (definition.saveEditor?.saveFields.length ?? 0);
}

function categories(definition: SolithDefinitionV1): string[] {
  return [...new Set([
    ...(definition.memoryFeatures ?? []).map((feature) => feature.category),
    ...(definition.saveEditor?.saveFields ?? []).map((field) => field.category),
  ])];
}

function writeHubDefinition(record: z.infer<typeof HubDefinitionSchema>): void {
  const definition = trustHubCertification(
    record.definition_payload,
    record.cert_level,
    record.executable_hash,
  );
  if (definition.id !== record.game_id) {
    throw new Error(`Hub definition game_id mismatch for ${record.id}`);
  }

  db.run('BEGIN');
  try {
    const updatedAt = Date.parse(record.updated_at);
    const verificationStatus =
      record.cert_level === 'L3_Certified' ? 'verified' : 'community';
    upsertDefinitionPayload(
      record.id,
      record.game_id,
      JSON.stringify(definition),
      verificationStatus,
      'solith-hub',
      record.updated_at,
      { certLevel: record.cert_level, updatedAt },
    );

    const existing = getCatalogEntry(record.game_id);
    const definitionCategories = categories(definition);
    const entryCategories = definitionCategories.length > 0
      ? definitionCategories
      : existing?.categories ?? [];
    const sources = [
      ...(existing?.sources.filter((source) => source.provider !== 'solith-hub') ?? []),
      {
        provider: 'solith-hub' as const,
        url: `${SOLITH_HUB_BASE_URL}/catalog/sync`,
        lastSyncedAt: record.updated_at,
      },
    ];

    upsertCatalogEntry({
      catalogGameId: record.game_id,
      displayName: definition.title,
      steamAppId: existing?.steamAppId,
      executables: definition.target.executables,
      categories: entryCategories,
      headerUrl: existing?.headerUrl,
      coverUrl: existing?.coverUrl,
      iconUrl: existing?.iconUrl,
      verificationStatus,
      sources,
      hasModPack: true,
      modPackId: record.id,
      cheatCount: cheatCount(definition),
      searchableText: buildSearchableText({
        displayName: definition.title,
        executables: definition.target.executables,
        categories: entryCategories,
      }),
    });
    db.run('COMMIT');
    void db.schedulePersistence();
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function timestampToSince(timestamp: number): string {
  return timestamp > 0
    ? new Date(timestamp).toISOString()
    : '1970-01-01T00:00:00.000Z';
}

export async function syncCommunityDefinitions(
  options: CommunitySyncOptions = {},
): Promise<CommunitySyncResult> {
  // This guard must remain before fetch selection or URL construction: disabled
  // means no network traffic, including discovery or health requests.
  if (getSetting('communitySyncEnabled') !== true) {
    return {
      status: 'disabled',
      imported: 0,
      skippedUserDefinitions: 0,
      rejected: 0,
      pages: 0,
      maxLocalTimestamp: getMaxHubDefinitionUpdatedAt(),
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let cursor = timestampToSince(getMaxHubDefinitionUpdatedAt());
  let imported = 0;
  let skippedUserDefinitions = 0;
  let rejected = 0;
  let pages = 0;
  let exhausted = false;

  while (pages < MAX_SYNC_PAGES) {
    const url = new URL('/catalog/sync', SOLITH_HUB_BASE_URL);
    url.searchParams.set('since', cursor);
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Solith Hub sync failed with HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_SYNC_RESPONSE_BYTES) {
      throw new Error('Solith Hub sync response exceeded the size limit');
    }
    const rawText = await response.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_SYNC_RESPONSE_BYTES) {
      throw new Error('Solith Hub sync response exceeded the size limit');
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error('Solith Hub sync returned invalid JSON');
    }
    const batch = HubSyncResponseSchema.parse(parsedJson);
    pages += 1;
    for (const record of batch.definitions) {
      if (
        !options.overwriteUserDefinitions &&
        hasUserAuthoredDefinition(record.game_id)
      ) {
        skippedUserDefinitions += 1;
        continue;
      }
      try {
        writeHubDefinition(record);
        imported += 1;
      } catch (error) {
        rejected += 1;
        logTrainerSync(
          'solith-hub',
          'rejected',
          `Record ${record.id}: ${error instanceof Error ? error.message : 'invalid_definition'}`,
        );
      }
    }

    if (!batch.has_more) {
      exhausted = true;
      break;
    }
    if (batch.next_since <= cursor) {
      throw new Error('Solith Hub returned a non-advancing sync cursor');
    }
    cursor = batch.next_since;
  }

  if (!exhausted) {
    throw new Error(`Solith Hub sync exceeded ${MAX_SYNC_PAGES} pages`);
  }

  logTrainerSync(
    'solith-hub',
    'success',
    `Imported ${imported}; preserved ${skippedUserDefinitions} user definitions; rejected ${rejected}`,
    imported,
  );
  return {
    status: 'synced',
    imported,
    skippedUserDefinitions,
    rejected,
    pages,
    maxLocalTimestamp: getMaxHubDefinitionUpdatedAt(),
  };
}

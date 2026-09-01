import { z } from 'zod';

/**
 * ROADMAP §5.9 "bounded payload" + "declarative catalog/profile metadata
 * only" — this schema is the entire surface a signed catalog update may
 * touch. There is deliberately no field for executable content, scripts,
 * arbitrary file paths, or the Phase 4 artwork-rights class (see
 * types.ts's CatalogUpdateRecord doc comment).
 */
const CatalogUpdateRecordKindSchema = z.enum([
  'add',
  'correct',
  'launcher-release-addition',
  'eligibility-change',
  'trainer-availability',
  'artwork-metadata',
  'merge-alias',
  'blocked-revoked',
]);

/** https-only — rejects javascript:/data:/file: and any other non-http(s) scheme, which z.string().url() alone would accept. */
const HttpsUrlSchema = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https:// URL');

const CatalogEntryPatchSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    steamAppId: z.number().int().positive().optional(),
    executables: z.array(z.string().min(1).max(260)).max(20).optional(),
    categories: z.array(z.string().min(1).max(60)).max(20).optional(),
    headerUrl: HttpsUrlSchema.optional(),
    coverUrl: HttpsUrlSchema.optional(),
    iconUrl: HttpsUrlSchema.optional(),
    verificationStatus: z.enum(['verified', 'community', 'metadata-only', 'unverified']).optional(),
    hasModPack: z.boolean().optional(),
    modPackId: z.string().max(200).optional(),
    cheatCount: z.number().int().min(0).max(10000).optional(),
    antiCheat: z.enum(['none', 'protected-multiplayer', 'protected-online-only', 'unknown']).optional(),
    offlinePlayAvailable: z.boolean().optional(),
    catalogExclusionFlags: z
      .array(
        z.enum([
          'mmo',
          'competitive-online-only',
          'no-meaningful-offline-play',
          'cloud-only',
          'dedicated-server',
          'demo',
          'soundtrack',
          'editor-tool',
          'dlc-only',
          'unsupported-delisted',
        ]),
      )
      .max(10)
      .optional(),
    explicitlyUnsupported: z.boolean().optional(),
    releaseDate: z.string().max(40).optional(),
    isAllTimeClassic: z.boolean().optional(),
  })
  .strict();

export const CatalogUpdateRecordSchema = z
  .object({
    kind: CatalogUpdateRecordKindSchema,
    catalogGameId: z.string().min(1).max(120),
    patch: CatalogEntryPatchSchema.optional(),
    mergeIntoCatalogGameId: z.string().min(1).max(120).optional(),
  })
  .strict();

/** Bounded record count — ROADMAP §5.9 "bounded payload," not an unlimited stream. */
export const MAX_CATALOG_UPDATE_RECORDS = 2000;

export const CatalogUpdateManifestSchema = z
  .object({
    version: z.number().int().positive(),
    createdAt: z.string().min(1).max(40),
    notice: z.string().max(500),
    records: z.array(CatalogUpdateRecordSchema).min(1).max(MAX_CATALOG_UPDATE_RECORDS),
  })
  .strict();

export const SignedCatalogUpdatePackageSchema = z
  .object({
    manifest: CatalogUpdateManifestSchema,
    signature: z.string().min(1).max(2000),
  })
  .strict();

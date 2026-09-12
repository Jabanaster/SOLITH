/**
 * Phase 3.2 — provider-neutral ingest contract validation (Mission 3/4).
 *
 * No Steam-specific/Epic-specific/GOG-specific schema — one shape for every
 * provider, matching src/core/provider-catalog/types.ts's ProviderGameRecord
 * in the main repo. Every bound below exists to make an ingest request
 * structurally incapable of unbounded memory/storage growth (Mission 4/16).
 */
import { z } from 'zod';

/**
 * Real-measured limit, not a round guess. `applyIngestBatch` submits every
 * record's writes (up to 3 statements/record, ~38 bound SQL params/record in
 * the EXACT/HIGH/UNLINKED case) as ONE atomic `db.batch()` call so the whole
 * batch commits or rolls back together (Mission 5). D1 (SQLite-backed)
 * refuses a batch once the TOTAL bound-parameter count across every
 * statement in that one `db.batch()` call gets too large — this is a
 * cumulative limit across the whole call, not a per-statement one. Probed
 * empirically against the real local D1 runtime (see
 * tests/backend-ingest-scale-e2e.test.ts's Mission 18 investigation):
 * 100 records (~3,800 total params) succeeded, 150 records (~5,700 total
 * params) failed with `D1_ERROR: too many SQL variables`. 2000 (the
 * originally-declared bound) failed outright on every real batch anywhere
 * near that size — the ingest endpoint would 500 on real production traffic
 * before this fix. 75 keeps meaningful headroom below the proven-good 100,
 * for records that land in the POSSIBLE/AMBIGUOUS branch and can write more
 * than 3 statements when a title matches several candidates.
 */
export const MAX_RECORDS_PER_BATCH = 75;
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024; // 4 MiB
export const MAX_FIELD_LENGTH = 200;
export const MAX_GENRES = 20;
export const MAX_TAGS = 20;
export const MAX_URL_LENGTH = 500;

/** Known providers this backend accepts ingest for — an unknown provider is rejected, not silently accepted. */
export const KNOWN_PROVIDERS = ['steam', 'gog', 'epic', 'ubisoft', 'ea', 'xbox', 'battlenet'] as const;

const providerSchema = z.enum(KNOWN_PROVIDERS);

/**
 * Only http(s) URLs, length-bounded. Explicitly rejects `javascript:`,
 * `data:`, `file:`, and any other scheme (Mission 16: "javascript: URL").
 */
const safeUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .refine((value) => /^https?:\/\//i.test(value), { message: 'must be an http(s) URL' });

const boundedTextSchema = z.string().min(1).max(MAX_FIELD_LENGTH);

export const providerGameRecordSchema = z.object({
  provider: providerSchema,
  providerGameId: z.string().min(1).max(128),
  title: boundedTextSchema,
  type: z.enum(['game', 'dlc', 'demo', 'tool', 'soundtrack', 'server', 'other']),
  storeUrl: safeUrlSchema.optional(),
  releaseDate: z.string().max(32).optional(),
  developer: boundedTextSchema.optional(),
  publisher: boundedTextSchema.optional(),
  genres: z.array(z.string().max(MAX_FIELD_LENGTH)).max(MAX_GENRES).optional(),
  tags: z.array(z.string().max(MAX_FIELD_LENGTH)).max(MAX_TAGS).optional(),
  rating: z.number().min(0).max(100).optional(),
  ratingSource: boundedTextSchema.optional(),
  popularityRank: z.number().int().min(0).optional(),
  popularitySource: boundedTextSchema.optional(),
  lastUpdated: z.string().max(64),
  rawRevision: z.string().max(256).optional(),
})
  // Reject unknown/untrusted fields (Mission 3: "Reject unknown/untrusted
  // fields where appropriate") — a client cannot smuggle extra columns
  // through to storage this way.
  .strict();

export const providerCatalogBatchSchema = z
  .object({
    provider: providerSchema,
    syncId: z.string().min(1).max(128),
    providerRevision: z.string().max(256).optional(),
    observedAt: z.string().max(64),
    records: z.array(providerGameRecordSchema).max(MAX_RECORDS_PER_BATCH),
    /**
     * Owner Follow-up Mission 1 — groups batches that together represent one
     * authoritative full-catalog enumeration attempt for this provider. Every
     * batch belonging to the same paginated sync run must share the same
     * cycleId. Omitted for callers not participating in lifecycle tracking
     * (e.g. a one-off correction batch) — such a batch never opens or closes
     * a cycle and can never contribute absence evidence.
     */
    syncCycleId: z.string().min(1).max(128).optional(),
    /**
     * Asserted ONLY by the caller (adapter/scheduler), never inferred by the
     * server from batch count/timing: "this batch was the FINAL page of a
     * complete, successful enumeration of this provider's entire catalog."
     * A false assertion here is a caller bug, not a server one — the server
     * trusts this exactly as much as it trusts `provider`/`syncId`, all of
     * which come from the same authenticated internal caller. Defaults to
     * false so a caller that says nothing never triggers absence evaluation.
     */
    cycleComplete: z.boolean().optional().default(false),
  })
  .strict()
  .refine((batch) => batch.records.every((r) => r.provider === batch.provider), {
    message: 'every record.provider must match the batch provider — no cross-provider overwrite via a mislabeled record',
  })
  .refine((batch) => !batch.cycleComplete || Boolean(batch.syncCycleId), {
    message: 'cycleComplete:true requires a syncCycleId — a completion signal with no cycle to close is a malformed request, not absence evidence',
  });

export type ProviderCatalogBatch = z.infer<typeof providerCatalogBatchSchema>;
export type ValidatedProviderGameRecord = z.infer<typeof providerGameRecordSchema>;

/**
 * SOLITH Phase 2 Part B — read-only discovery-catalog / trainer-coverage /
 * trainer-artifact sync backend.
 *
 * ============================================================================
 * SCOPE: READ-ONLY. There is no write/upload endpoint of any kind here.
 * Community uploads (qualifyForUpload / createCommunitySubmission in the
 * main repo) are NOT wired to this or any network endpoint by this file.
 * ============================================================================
 *
 * Deliberately a SIBLING Worker to solith-hub-backend rather than new routes
 * added to it. Reasoning (owner gave this as an explicit judgment call):
 * solith-hub-backend already owns the path `/catalog/sync`, but for a
 * completely different feature (Community Definition Hub submissions —
 * untrusted L0_Community/L3_Certified definition rows) with an INCOMPATIBLE
 * response shape (`{definitions, count, next_since, has_more}`) and a
 * different trust model (accepts POST /submit from arbitrary clients).
 * This backend's `/catalog/sync` means something else entirely — a curated,
 * read-only discovery-catalog + trainer-coverage delta matching
 * `SyncManifestDelta` (main repo's src/core/sync-manifest/types.ts) exactly.
 * Reusing the same Worker/route would either collide outright or force one
 * path to serve two incompatible response shapes depending on undocumented
 * context. A separate Worker keeps the two trust models, two D1 databases,
 * and two response contracts cleanly independent — least-privilege applies
 * to services, not just to individual bindings.
 *
 * Endpoints (see README.md for the full security-requirements checklist):
 *   GET /health              - status/version, no auth, trivial
 *   GET /catalog/sync        - SyncManifestDelta-shaped JSON, ?since=<rev>
 *   GET /artifacts/:hash     - raw artifact bytes by exact 64-hex SHA-256
 */
import { Hono } from 'hono';
import {
  artifactHashParamSchema,
  projectDiscoveryCatalogEntry,
  projectTrainerCoverageRow,
  syncQuerySchema,
  type DeletedCatalogEntryRow,
  type DiscoveryCatalogEntryRow,
  type TrainerCoverageRow,
} from './schema.js';

type Bindings = {
  DB: D1Database;
};

/**
 * Bounds the number of changed rows a single `/catalog/sync` response can
 * carry — a request-size/response-size DoS guard, not a correctness limit:
 * when a table has more than this many rows newer than `since`, the
 * reported revision cursor is capped to the highest revision actually
 * INCLUDED in the response (see `boundedRevision` below), never to the
 * server's true current revision, so the client's next sync call
 * correctly picks up the remainder instead of silently skipping rows that
 * got truncated out of this response.
 */
const MAX_SYNC_ROWS_PER_TABLE = 500;

/** Aligned with the main repo's client-side trainer-artifact cap (src/core/trainer-artifact-cache/cache.ts's MAX_TRAINER_ARTIFACT_BYTES) — same 256 MiB ceiling on both ends of the wire. */
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

const EPOCH_REVISION = '0';

function log(event: string, fields: Record<string, unknown> = {}): void {
  // Structured, single-line JSON logging. Audited: never includes request
  // bodies, headers, IPs, or any credential/secret material — there is none
  // in this read-only service (no ADMIN_TOKEN, no user accounts, no PII).
  console.log(JSON.stringify({ service: 'solith-catalog-backend', event, ...fields, ts: new Date().toISOString() }));
}

function errorResponse(status: 400 | 404 | 500, error: string, details?: unknown) {
  // Deterministic, fixed JSON error shape everywhere in this service — never
  // a raw stack trace or engine-specific error string leaked to the client.
  return { body: { error, ...(details !== undefined ? { details } : {}) }, status };
}

export const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    log('health_check', { result: 'ok' });
    return c.json(
      {
        service: 'solith-catalog-backend',
        status: 'healthy',
        database: 'connected',
        scope: 'read-only',
        time: new Date().toISOString(),
      },
      200,
      { 'content-type': 'application/json', 'cache-control': 'no-store' },
    );
  } catch (error) {
    log('health_check', { result: 'error' });
    return c.json(
      {
        service: 'solith-catalog-backend',
        status: 'unhealthy',
        database: 'disconnected',
        time: new Date().toISOString(),
      },
      503,
      { 'content-type': 'application/json', 'cache-control': 'no-store' },
    );
  }
});

app.get('/catalog/sync', async (c) => {
  // Malformed manifest rejection: bad `since` -> 400, never a 500. Query
  // params are bounded (max 32 chars, see schema.ts) before regex
  // validation, so an oversized query string is rejected cheaply.
  const parsed = syncQuerySchema.safeParse({ since: c.req.query('since') ?? undefined });
  if (!parsed.success) {
    log('sync_rejected', { reason: 'invalid_since' });
    const { body, status } = errorResponse(400, 'invalid_query', parsed.error.flatten());
    return c.json(body, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  const since = parsed.data.since ?? EPOCH_REVISION;
  const sinceValue = Number(since);
  log('sync_accepted', { since });

  const stateRow = await c.env.DB.prepare(
    'SELECT catalog_revision, trainer_revision FROM sync_state WHERE id = ?1',
  )
    .bind('global')
    .first<{ catalog_revision: number; trainer_revision: number }>();
  const currentGlobalRevision = stateRow?.catalog_revision ?? 0;

  const [catalogResult, coverageResult, deletedResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT solith_game_id, title, normalized_title, aliases_json, provider_ids_json, type,
              release_date, release_year, genres_json, tags_json, trainer_available, ct_available,
              updated_at, revision
         FROM discovery_catalog_entries
        WHERE revision > ?1
        ORDER BY revision ASC
        LIMIT ${MAX_SYNC_ROWS_PER_TABLE}`,
    )
      .bind(sinceValue)
      .all<DiscoveryCatalogEntryRow>(),
    c.env.DB.prepare(
      `SELECT game_id, trainer_available, trainer_id, trainer_version, game_build_hint,
              cheat_count, trust_state, artifact_hash, artifact_size_bytes, last_updated,
              author, source, revision
         FROM trainer_coverage
        WHERE revision > ?1
        ORDER BY revision ASC
        LIMIT ${MAX_SYNC_ROWS_PER_TABLE}`,
    )
      .bind(sinceValue)
      .all<TrainerCoverageRow>(),
    c.env.DB.prepare(
      `SELECT solith_game_id, deleted_at, revision
         FROM deleted_catalog_entries
        WHERE revision > ?1
        ORDER BY revision ASC
        LIMIT ${MAX_SYNC_ROWS_PER_TABLE}`,
    )
      .bind(sinceValue)
      .all<DeletedCatalogEntryRow>(),
  ]);

  const catalogRows = catalogResult.results ?? [];
  const coverageRows = coverageResult.results ?? [];
  const deletedRows = deletedResult.results ?? [];

  // Revision-monotonicity safety: if a table was truncated at the row cap,
  // report only up to the highest revision actually delivered for THAT
  // table, so the client never advances its cursor past data it did not
  // receive. Otherwise (table not truncated) that table permits advancing
  // all the way to the server's true current global revision.
  const boundedRevision = (rows: { revision: number }[]): number => {
    if (rows.length < MAX_SYNC_ROWS_PER_TABLE) return currentGlobalRevision;
    return rows[rows.length - 1]!.revision;
  };

  const reportedRevision = Math.min(
    boundedRevision(catalogRows),
    boundedRevision(coverageRows),
    boundedRevision(deletedRows),
  );
  // Never let the reported revision regress below what the caller already
  // asked "since" — a defensive floor, not expected to ever trigger given
  // the min() above already can't go below currentGlobalRevision when
  // nothing was truncated, and truncated tables' last row revision is by
  // definition > sinceValue (the WHERE clause guarantees it).
  const safeRevision = Math.max(reportedRevision, sinceValue);
  const revisionString = String(safeRevision);

  log('sync_served', {
    since,
    reportedRevision: revisionString,
    catalogRows: catalogRows.length,
    coverageRows: coverageRows.length,
    deletedRows: deletedRows.length,
  });

  return c.json(
    {
      catalogRevision: revisionString,
      trainerRevision: revisionString,
      changedCatalogEntries: catalogRows.map(projectDiscoveryCatalogEntry),
      changedTrainerCoverage: coverageRows.map(projectTrainerCoverageRow),
      deletedSolithGameIds: deletedRows.map((row) => row.solith_game_id),
    },
    200,
    {
      'content-type': 'application/json',
      // Catalog/manifest data changes over time — must NOT be cached
      // aggressively, unlike the immutable artifact endpoint below.
      'cache-control': 'no-store',
    },
  );
});

app.get('/artifacts/:hash', async (c) => {
  const rawHash = c.req.param('hash');
  const parsed = artifactHashParamSchema.safeParse(rawHash);
  if (!parsed.success) {
    // Reject BEFORE any storage lookup — no arbitrary path/ID lookup ever
    // reaches the `artifacts` table for a malformed key.
    log('artifact_rejected', { reason: 'bad_hash_format' });
    const { body, status } = errorResponse(400, 'invalid_artifact_hash');
    return c.json(body, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }
  const hash = parsed.data;

  const row = await c.env.DB.prepare(
    'SELECT artifact_hash, size_bytes, content_type, blob FROM artifacts WHERE artifact_hash = ?1',
  )
    .bind(hash)
    .first<{ artifact_hash: string; size_bytes: number; content_type: string; blob: ArrayBuffer }>();

  if (!row) {
    log('artifact_cache_miss', { hash });
    const { body, status } = errorResponse(404, 'artifact_not_found');
    return c.json(body, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  // Strict size limit, enforced on the READ path too (defense in depth —
  // this should already be true of anything that ever got inserted, but
  // the server never trusts its own storage blindly).
  const bytes = new Uint8Array(row.blob);
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    log('artifact_rejected', { reason: 'stored_blob_too_large', hash, sizeBytes: bytes.byteLength });
    const { body, status } = errorResponse(500, 'artifact_exceeds_size_limit');
    return c.json(body, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  // Server-side SHA-256 re-verification: never trust the primary key alone.
  // If the stored bytes no longer hash to their own key (corruption, or a
  // bug/attack somewhere in the write path this phase doesn't even expose),
  // refuse to serve them rather than silently returning wrong/tampered
  // bytes under a hash that no longer identifies them.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actualHash !== hash) {
    log('hash_mismatch', { requestedHash: hash, actualHash });
    const { body, status } = errorResponse(500, 'stored_artifact_integrity_check_failed');
    return c.json(body, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  log('artifact_cache_hit', { hash, sizeBytes: bytes.byteLength });
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': row.content_type || 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      // Immutable, content-addressed artifact: safe to cache aggressively
      // and forever — the hash IS the content, so nothing can ever change
      // under this URL without changing the URL itself.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

app.notFound((c) => {
  const { body, status } = errorResponse(404, 'not_found');
  return c.json(body, status, { 'content-type': 'application/json' });
});

app.onError((error, c) => {
  // Deterministic error response — no stack trace or engine error string
  // ever reaches the client. The real error is logged server-side only,
  // and even that log line carries no request body/header/credential data.
  log('unhandled_error', { message: error instanceof Error ? error.message : 'unknown' });
  const { body, status } = errorResponse(500, 'internal_error');
  return c.json(body, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
});

export default app;

/**
 * Bounded timeouts: this Worker sets no explicit request timeout because
 * Cloudflare Workers already enforce a platform-level CPU-time limit on
 * every invocation (not wall-clock, CPU time actually consumed) — see
 * https://developers.cloudflare.com/workers/platform/limits/#worker-limits.
 * Every handler above does a small, bounded number of indexed D1 queries
 * with LIMIT clauses and no loops over unbounded input, so it is
 * structurally incapable of approaching that limit; no additional
 * application-level timeout was judged necessary.
 *
 * No arbitrary server-side URL fetching: grep this file — there is no
 * `fetch(` call anywhere in it. Nothing here ever fetches a client- or
 * database-supplied URL. All data comes from bound D1 queries.
 *
 * No filesystem path supplied by a client: Workers have no filesystem by
 * construction (no `fs` module, no local disk) — there is no code path
 * here that could accept one even if a client tried to supply it.
 *
 * No credentials in logs / no secret material: this service defines no
 * `ADMIN_TOKEN` or any other secret binding (unlike solith-hub-backend) —
 * there is nothing secret to leak. Every `log(...)` call above passes only
 * hashes, revision numbers, row counts, and fixed reason strings.
 *
 * Environment-based secrets/configuration: N/A. This Bindings type has only
 * `DB` (the D1 binding) — no environment variables or secrets are read
 * anywhere in this file, because a read-only public catalog/artifact
 * service needs none.
 */

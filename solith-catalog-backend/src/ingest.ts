/**
 * Phase 3.2 — backend provider-ingest write path (Missions 1-11).
 *
 * ============================================================================
 * WRITE TRUST BOUNDARY (Mission 1/2): the ONLY entity authorized to call
 * this endpoint is a trusted provider-sync worker/service holding
 * `INGEST_TOKEN` (an env secret, never shipped to the Electron client — see
 * wrangler.jsonc's vars/secrets and tests/ingest-secret-boundary.test.ts).
 * There is no public unrestricted POST endpoint here: every request must
 * present a matching `Authorization: Bearer <INGEST_TOKEN>` header or is
 * rejected before any parsing/DB work happens. The desktop renderer is
 * architecturally incapable of calling this — it has no code path that
 * imports this module or references the token (see
 * tests/provider-secret-boundary.test.ts in the main repo, and this
 * package's own static-boundary test).
 * ============================================================================
 */
import type { Context } from 'hono';
import {
  providerCatalogBatchSchema,
  MAX_REQUEST_BYTES,
  type ProviderCatalogBatch,
  type ValidatedProviderGameRecord,
} from './ingest-schema.js';
import { matchProviderRecordToCanonical, type CanonicalCandidateGame } from './shared/cross-provider-match.js';
import { normalizeCatalogTitle } from './shared/normalize-title.js';
import { computeCanonicalLifecycleStatus, nextLifecycleStatusOnCycleClose, type LifecycleStatus } from './tombstone-lifecycle.js';

type Bindings = {
  DB: D1Database;
  INGEST_TOKEN?: string;
};

export interface IngestResult {
  status: 'applied' | 'idempotent-replay' | 'rejected';
  provider: string;
  syncId: string;
  recordsReceived: number;
  recordsApplied: number;
  canonicalGamesCreated: number;
  canonicalGamesLinked: number;
  candidatesRecorded: number;
  reason?: string;
  /** Present only when this batch closed a sync cycle (Owner Follow-up Mission 1). */
  lifecycleEvaluation?: {
    cycleId: string;
    markedStale: number;
    markedTombstoned: number;
    discoveryEntriesUpdated: number;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** SHA-256 via Web Crypto (native to the Workers runtime, no Node polyfill needed) — same primitive already used for artifact integrity verification above. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function batchContentHash(batch: ProviderCatalogBatch): Promise<string> {
  // Deterministic hash of the batch's actual content (not just its syncId) —
  // used to detect "same syncId, DIFFERENT content" (a genuine conflict,
  // never silently accepted) vs. a true byte-identical replay (idempotent).
  const basis = JSON.stringify({ provider: batch.provider, records: batch.records });
  return sha256Hex(basis);
}

/**
 * Mission 1/2/15 — authenticates the caller as the trusted ingest service.
 * Fails closed (401) on ANY of: missing token configured server-side,
 * missing Authorization header, or a non-matching token. Never logs the
 * token itself, on either side of the comparison.
 */
export function authenticateIngestRequest(c: Context<{ Bindings: Bindings }>): { ok: true } | { ok: false; status: 401; error: string } {
  const configuredToken = c.env.INGEST_TOKEN;
  if (!configuredToken || configuredToken.trim().length === 0) {
    // Fail closed: an ingest endpoint with NO configured token must refuse
    // every request, never fall open to "no auth required".
    return { ok: false, status: 401, error: 'ingest_not_configured' };
  }

  const authHeader = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const presentedToken = match?.[1] ?? '';

  if (presentedToken.length !== configuredToken.length || !timingSafeStringEqual(presentedToken, configuredToken)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}

/** Constant-time string comparison — avoids a timing side-channel on token comparison. */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface DiscoveryCandidateRow {
  solith_game_id: string;
  normalized_title: string;
  release_year: number | null;
  provider_ids_json: string;
}

interface ProviderPublisherRow {
  provider: string;
  provider_game_id: string;
  publisher: string | null;
}

/**
 * SQLite (and D1, which is SQLite-backed) refuses a statement with more than
 * ~999 bound variables ("too many SQL variables"). A batch can carry up to
 * MAX_RECORDS_PER_BATCH (2000) records, so a naive single `IN (?,?,...)`
 * query built from every distinct title in the batch — or worse, the 2
 * params/row provider+id OR-clause below — silently 500s on any real batch
 * anywhere near that size. Found via the Mission 18 scale E2E (10,000 real
 * records, 2000/batch): `D1_ERROR: too many SQL variables at offset 331:
 * SQLITE_ERROR`. Chunking keeps every query's parameter count safely under
 * the limit regardless of batch size.
 */
const MAX_SQL_VARIABLES_PER_QUERY = 400;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function loadCandidatesForTitles(db: D1Database, normalizedTitles: string[]): Promise<Map<string, CanonicalCandidateGame[]>> {
  const result = new Map<string, CanonicalCandidateGame[]>();
  if (normalizedTitles.length === 0) return result;

  const rows: DiscoveryCandidateRow[] = [];
  for (const titleChunk of chunk(normalizedTitles, MAX_SQL_VARIABLES_PER_QUERY)) {
    const placeholders = titleChunk.map(() => '?').join(',');
    const chunkRows =
      (
        await db
          .prepare(`SELECT solith_game_id, normalized_title, release_year, provider_ids_json FROM discovery_catalog_entries WHERE normalized_title IN (${placeholders})`)
          .bind(...titleChunk)
          .all<DiscoveryCandidateRow>()
      ).results ?? [];
    rows.push(...chunkRows);
  }

  // Enrich with publisher from an already-linked provider record (mirrors the main repo's sync-orchestrator.ts logic exactly).
  const allProviderGameIdPairs: Array<{ provider: string; providerGameId: string }> = [];
  for (const row of rows) {
    const ids = JSON.parse(row.provider_ids_json) as Record<string, string>;
    for (const [provider, providerGameId] of Object.entries(ids)) {
      allProviderGameIdPairs.push({ provider, providerGameId });
    }
  }
  const publisherByPair = new Map<string, string>();
  // 2 bound params per pair — half the chunk size so the total stays under the limit.
  for (const pairChunk of chunk(allProviderGameIdPairs, Math.floor(MAX_SQL_VARIABLES_PER_QUERY / 2))) {
    if (pairChunk.length === 0) continue;
    const orClauses = pairChunk.map(() => '(provider = ? AND provider_game_id = ?)').join(' OR ');
    const params = pairChunk.flatMap((p) => [p.provider, p.providerGameId]);
    const pubRows =
      (await db.prepare(`SELECT provider, provider_game_id, publisher FROM provider_catalog_records WHERE ${orClauses}`).bind(...params).all<ProviderPublisherRow>()).results ?? [];
    for (const r of pubRows) {
      if (r.publisher) publisherByPair.set(`${r.provider}:${r.provider_game_id}`, r.publisher);
    }
  }

  for (const row of rows) {
    const ids = JSON.parse(row.provider_ids_json) as Record<string, string>;
    let publisher: string | undefined;
    for (const [provider, providerGameId] of Object.entries(ids)) {
      const found = publisherByPair.get(`${provider}:${providerGameId}`);
      if (found) {
        publisher = found;
        break;
      }
    }
    const candidate: CanonicalCandidateGame = {
      canonicalGameId: row.solith_game_id,
      normalizedTitle: row.normalized_title,
      releaseYear: row.release_year ?? undefined,
      publisher,
      linkedProviderIds: Object.entries(ids).map(([provider, providerGameId]) => ({ provider, providerGameId })),
    };
    const bucket = result.get(row.normalized_title) ?? [];
    bucket.push(candidate);
    result.set(row.normalized_title, bucket);
  }
  return result;
}

async function mintCatalogCanonicalId(seed: string): Promise<string> {
  return `canonical:catalog:${(await sha256Hex(`catalog:${seed}`)).slice(0, 32)}`;
}

/**
 * Real bug found via the Owner Follow-up Mission 1 hostile "reappearance"
 * test: re-ingesting a record that was ALREADY authoritatively linked (from
 * an earlier batch) re-ran the full cross-provider matcher from scratch,
 * which then found that record's OWN existing discovery_catalog_entries row
 * as a candidate via weak title-only evidence (POSSIBLE — "never final
 * authority", per the Phase 3.1 P1 fix) instead of recognizing it as the
 * exact same game it is ALREADY linked to. A POSSIBLE match never writes
 * canonical_provider_links or touches discovery_catalog_entries at all, so
 * a record with no publisher/releaseDate that went STALE/TOMBSTONED could
 * never come back to ACTIVE at the discovery (canonical) level on
 * reappearance — only its own provider_catalog_records row did.
 *
 * Fix: before running the fuzzy matcher, check whether THIS EXACT
 * (provider, providerGameId) already has an authoritative link. If so,
 * that answer is definitionally correct and needs no re-matching — reuse
 * it directly as EXACT confidence, every time, for every subsequent
 * observation of the same provider identity.
 */
async function loadExistingLinks(db: D1Database, provider: string, providerGameIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const distinctIds = [...new Set(providerGameIds)];
  if (distinctIds.length === 0) return result;
  for (const idChunk of chunk(distinctIds, MAX_SQL_VARIABLES_PER_QUERY - 1)) {
    const placeholders = idChunk.map(() => '?').join(',');
    const rows =
      (
        await db
          .prepare(`SELECT provider_game_id, canonical_game_id FROM canonical_provider_links WHERE provider = ? AND provider_game_id IN (${placeholders})`)
          .bind(provider, ...idChunk)
          .all<{ provider_game_id: string; canonical_game_id: string }>()
      ).results ?? [];
    for (const row of rows) result.set(row.provider_game_id, row.canonical_game_id);
  }
  return result;
}

interface ProviderRecordLifecycleRow {
  provider_game_id: string;
  lifecycle_status: LifecycleStatus;
  last_seen_in_sync_at: string | null;
  lifecycle_last_transitioned_by_cycle_id: string | null;
}

interface CanonicalLinkRow {
  provider: string;
  provider_game_id: string;
  canonical_game_id: string;
}

/**
 * Owner Follow-up Mission 1 — closes a sync cycle: decides, PER PROVIDER
 * RECORD, whether it was genuinely observed during this cycle (its
 * `last_seen_in_sync_at` falls on or after the cycle's fixed `started_at`)
 * or is real absence evidence, then rolls the result up to every affected
 * canonical game's discovery-level status.
 *
 * Runs as ITS OWN atomic step, separate from the ingest batch that
 * triggered it (which has already committed by the time this runs) — this
 * is a maintenance pass over existing rows, not part of applying the
 * triggering batch's own records, so it does not need to share that
 * batch's transaction. If this step fails partway, no row is left
 * inconsistent (every UPDATE below is independently idempotent — re-running
 * the whole evaluation against the same cycle boundary always converges to
 * the same result, see nextLifecycleStatusOnCycleClose's docs) and the
 * cycle's `completed_at` simply stays unset until a future call succeeds.
 *
 * Never invoked except from applyIngestBatch's `cycleComplete: true` path,
 * which itself only runs for a schema-valid, authenticated, successfully
 * applied batch — so a malformed/unauthenticated/failed request can never
 * reach this function (structural enforcement of "only a SUCCESSFULLY
 * COMPLETED authoritative provider sync may contribute absence evidence").
 */
export async function evaluateSyncCycleCompletion(
  db: D1Database,
  provider: string,
  cycleId: string,
): Promise<IngestResult['lifecycleEvaluation']> {
  const cycle = await db
    .prepare('SELECT started_at FROM provider_sync_cycles WHERE provider = ? AND cycle_id = ?')
    .bind(provider, cycleId)
    .first<{ started_at: string }>();
  if (!cycle) {
    // No real cycle boundary exists to evaluate against — never fabricate
    // one. Structurally shouldn't happen (the schema requires syncCycleId
    // alongside cycleComplete, and applyIngestBatch always opens the cycle
    // in the same batch before this runs), but absence of proof is not
    // proof of absence: do nothing rather than guess a boundary.
    return undefined;
  }
  const cycleStartedAt = cycle.started_at;

  const providerRecords =
    (
      await db
        .prepare('SELECT provider_game_id, lifecycle_status, last_seen_in_sync_at, lifecycle_last_transitioned_by_cycle_id FROM provider_catalog_records WHERE provider = ?')
        .bind(provider)
        .all<ProviderRecordLifecycleRow>()
    ).results ?? [];

  const transitions: Array<{ providerGameId: string; from: LifecycleStatus; to: LifecycleStatus }> = [];
  for (const row of providerRecords) {
    const wasObservedThisCycle = row.last_seen_in_sync_at !== null && row.last_seen_in_sync_at >= cycleStartedAt;
    const staleWasSetByThisSameCycle = row.lifecycle_status === 'STALE' && row.lifecycle_last_transitioned_by_cycle_id === cycleId;
    const next = nextLifecycleStatusOnCycleClose(row.lifecycle_status, wasObservedThisCycle, staleWasSetByThisSameCycle);
    if (next !== row.lifecycle_status) {
      transitions.push({ providerGameId: row.provider_game_id, from: row.lifecycle_status, to: next });
    }
  }

  let markedStale = 0;
  let markedTombstoned = 0;

  if (transitions.length > 0) {
    const updateStatements = transitions.map((t) =>
      db
        .prepare('UPDATE provider_catalog_records SET lifecycle_status = ?, lifecycle_last_transitioned_by_cycle_id = ? WHERE provider = ? AND provider_game_id = ? AND lifecycle_status = ?')
        .bind(t.to, cycleId, provider, t.providerGameId, t.from),
    );
    for (const t of transitions) {
      if (t.to === 'STALE') markedStale += 1;
      else if (t.to === 'TOMBSTONED') markedTombstoned += 1;
    }
    // Chunked into safe-sized atomic sub-batches — same real SQL-variable
    // ceiling documented on MAX_SQL_VARIABLES_PER_QUERY applies to db.batch()
    // as a whole, and a full-catalog lifecycle pass can easily exceed it.
    for (const statementChunk of chunk(updateStatements, 300)) {
      await db.batch(statementChunk);
    }
  }

  // Multi-provider-safe rollup (Mission 9/Owner Follow-up Mission 1): find
  // every canonical game with an AUTHORITATIVE link to this provider (only
  // EXACT/HIGH/UNLINKED records ever get one — POSSIBLE/AMBIGUOUS candidates
  // never did, so they have nothing to roll up), then recompute each one's
  // discovery-level status from EVERY provider currently linked to it, not
  // just this one.
  const linkedCanonicalIds = (
    await db.prepare('SELECT DISTINCT canonical_game_id FROM canonical_provider_links WHERE provider = ?').bind(provider).all<{ canonical_game_id: string }>()
  ).results?.map((r) => r.canonical_game_id) ?? [];

  let discoveryEntriesUpdated = 0;
  for (const idChunk of chunk(linkedCanonicalIds, MAX_SQL_VARIABLES_PER_QUERY)) {
    if (idChunk.length === 0) continue;
    const placeholders = idChunk.map(() => '?').join(',');
    const allLinksForTheseGames =
      (
        await db
          .prepare(`SELECT provider, provider_game_id, canonical_game_id FROM canonical_provider_links WHERE canonical_game_id IN (${placeholders})`)
          .bind(...idChunk)
          .all<CanonicalLinkRow>()
      ).results ?? [];

    const statusByProviderGameId = new Map<string, LifecycleStatus>();
    const providersToLookUp = [...new Set(allLinksForTheseGames.map((l) => l.provider))];
    for (const p of providersToLookUp) {
      const rows = (await db.prepare('SELECT provider_game_id, lifecycle_status FROM provider_catalog_records WHERE provider = ?').bind(p).all<{ provider_game_id: string; lifecycle_status: LifecycleStatus }>()).results ?? [];
      for (const r of rows) statusByProviderGameId.set(`${p}:${r.provider_game_id}`, r.lifecycle_status);
    }

    const linksByCanonicalId = new Map<string, LifecycleStatus[]>();
    for (const link of allLinksForTheseGames) {
      const status = statusByProviderGameId.get(`${link.provider}:${link.provider_game_id}`) ?? 'ACTIVE';
      const bucket = linksByCanonicalId.get(link.canonical_game_id) ?? [];
      bucket.push(status);
      linksByCanonicalId.set(link.canonical_game_id, bucket);
    }

    const currentDiscoveryStatus =
      (
        await db
          .prepare(`SELECT solith_game_id, lifecycle_status FROM discovery_catalog_entries WHERE solith_game_id IN (${placeholders})`)
          .bind(...idChunk)
          .all<{ solith_game_id: string; lifecycle_status: LifecycleStatus }>()
      ).results ?? [];
    const currentByGameId = new Map(currentDiscoveryStatus.map((r) => [r.solith_game_id, r.lifecycle_status]));

    const rollupUpdates: D1PreparedStatement[] = [];
    for (const [canonicalGameId, statuses] of linksByCanonicalId) {
      const derived = computeCanonicalLifecycleStatus(statuses);
      if (currentByGameId.get(canonicalGameId) !== derived) {
        rollupUpdates.push(db.prepare('UPDATE discovery_catalog_entries SET lifecycle_status = ? WHERE solith_game_id = ?').bind(derived, canonicalGameId));
      }
    }
    discoveryEntriesUpdated += rollupUpdates.length;
    for (const statementChunk of chunk(rollupUpdates, 300)) {
      await db.batch(statementChunk);
    }
  }

  await db.prepare('UPDATE provider_sync_cycles SET completed_at = ? WHERE provider = ? AND cycle_id = ?').bind(nowIso(), provider, cycleId).run();

  return { cycleId, markedStale, markedTombstoned, discoveryEntriesUpdated };
}

/**
 * Applies one validated, authenticated, idempotency-checked batch. Builds a
 * flat list of D1 statements and submits them via `db.batch()`, which
 * Cloudflare D1 executes as one atomic unit (Mission 5: no half-applied
 * canonical/provider relationship on partial failure).
 */
export async function applyIngestBatch(db: D1Database, batch: ProviderCatalogBatch): Promise<IngestResult> {
  const batchHash = await batchContentHash(batch);

  // Mission 7 — idempotency: a byte-identical resubmission of a (provider,
  // syncId) pair is recognized and answered without re-applying writes. A
  // DIFFERENT payload reusing the same syncId is a genuine conflict, never
  // silently accepted as an overwrite.
  const existingLog = await db
    .prepare('SELECT batch_hash, record_count FROM ingest_batch_log WHERE provider = ? AND sync_id = ?')
    .bind(batch.provider, batch.syncId)
    .first<{ batch_hash: string; record_count: number }>();

  if (existingLog) {
    if (existingLog.batch_hash === batchHash) {
      return {
        status: 'idempotent-replay',
        provider: batch.provider,
        syncId: batch.syncId,
        recordsReceived: batch.records.length,
        recordsApplied: 0,
        canonicalGamesCreated: 0,
        canonicalGamesLinked: 0,
        candidatesRecorded: 0,
        reason: 'identical batch already applied — no-op',
      };
    }
    return {
      status: 'rejected',
      provider: batch.provider,
      syncId: batch.syncId,
      recordsReceived: batch.records.length,
      recordsApplied: 0,
      canonicalGamesCreated: 0,
      canonicalGamesLinked: 0,
      candidatesRecorded: 0,
      reason: 'syncId already used for a DIFFERENT batch — conflict, refusing to overwrite',
    };
  }

  const nowMs = nowIso();
  const distinctTitles = [
    ...new Set(batch.records.map((r) => normalizeCatalogTitle(r.title)).filter((t): t is string => Boolean(t))),
  ];
  const candidatesByTitle = await loadCandidatesForTitles(db, distinctTitles);
  const existingLinkByProviderGameId = await loadExistingLinks(db, batch.provider, batch.records.map((r) => r.providerGameId));

  const statements: D1PreparedStatement[] = [];

  // Owner Follow-up Mission 1 — open (never re-open/move) this provider's
  // sync cycle if this batch names one. `DO NOTHING` is load-bearing: a
  // LATER batch in the same multi-page cycle must never push started_at
  // forward, or the absence-evaluation boundary at cycle-close would be
  // wrong (rows legitimately observed on an earlier page of THIS cycle
  // would look like they predate it).
  if (batch.syncCycleId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_sync_cycles (provider, cycle_id, started_at, completed_at) VALUES (?,?,?,NULL)
           ON CONFLICT(provider, cycle_id) DO NOTHING`,
        )
        .bind(batch.provider, batch.syncCycleId, nowMs),
    );
  }

  let canonicalGamesCreated = 0;
  let canonicalGamesLinked = 0;
  let candidatesRecorded = 0;
  let recordsApplied = 0;

  for (const record of batch.records as ValidatedProviderGameRecord[]) {
    // Rollback guard (Mission 6): identical to the main repo's client-side
    // fix — only THIS server-generated timestamp orders writes, never any
    // provider-supplied revision (Epic/GOG's are content hashes with no
    // ordering; even Steam's numeric one is provider-supplied and untrusted).
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_catalog_records
             (provider, provider_game_id, title, type, store_url, release_date, developer, publisher, genres_json, tags_json, rating, rating_source, popularity_rank, popularity_source, last_updated, raw_revision, lifecycle_status, last_seen_in_sync_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)
           ON CONFLICT(provider, provider_game_id) DO UPDATE SET
             title=excluded.title, type=excluded.type, store_url=excluded.store_url, release_date=excluded.release_date,
             developer=excluded.developer, publisher=excluded.publisher, genres_json=excluded.genres_json, tags_json=excluded.tags_json,
             rating=excluded.rating, rating_source=excluded.rating_source, popularity_rank=excluded.popularity_rank, popularity_source=excluded.popularity_source,
             last_updated=excluded.last_updated, raw_revision=excluded.raw_revision,
             lifecycle_status='ACTIVE', last_seen_in_sync_at=excluded.last_seen_in_sync_at
           WHERE excluded.last_updated >= provider_catalog_records.last_updated`,
        )
        .bind(
          record.provider,
          record.providerGameId,
          record.title,
          record.type,
          record.storeUrl ?? null,
          record.releaseDate ?? null,
          record.developer ?? null,
          record.publisher ?? null,
          JSON.stringify(record.genres ?? []),
          JSON.stringify(record.tags ?? []),
          record.rating ?? null,
          record.ratingSource ?? null,
          record.popularityRank ?? null,
          record.popularitySource ?? null,
          record.lastUpdated,
          record.rawRevision ?? null,
          nowMs, // last_seen_in_sync_at — Owner Follow-up Mission 1: any real observation is a reappearance signal, always forced ACTIVE regardless of prior STALE/TOMBSTONED status (WHERE guard above still protects last_updated from rollback; lifecycle reset on observation is intentionally unconditional)
        ),
    );
    recordsApplied += 1;

    const normalizedTitle = normalizeCatalogTitle(record.title);
    if (!normalizedTitle) continue;

    const existingLinkedCanonicalId = existingLinkByProviderGameId.get(record.providerGameId);
    let canonicalGameId: string;
    let effectiveConfidence: 'EXACT' | 'HIGH' | 'POSSIBLE' | 'AMBIGUOUS' | 'UNLINKED';
    let evidenceForLink: unknown = [];

    if (existingLinkedCanonicalId) {
      // Already authoritatively linked from an earlier ingest — that answer
      // is definitionally correct for THIS exact provider identity and
      // needs no re-matching (see loadExistingLinks' doc comment for the
      // real bug this fixes: without this, a reappearing record with no
      // publisher/releaseDate could only ever re-match itself via weak
      // title-only evidence, POSSIBLE, never reactivating its own
      // discovery-level status).
      canonicalGameId = existingLinkedCanonicalId;
      effectiveConfidence = 'EXACT';
      evidenceForLink = [{ source: 'already-linked-provider-identity', note: 'reused existing canonical_provider_links row — no re-matching performed' }];
      canonicalGamesLinked += 1;
    } else {
      const candidates = candidatesByTitle.get(normalizedTitle) ?? [];
      const matchResult = matchProviderRecordToCanonical({
        record: { ...record, genres: record.genres, tags: record.tags },
        candidates,
      });
      effectiveConfidence = matchResult.confidence;
      evidenceForLink = matchResult.candidates;
      const topCandidate = matchResult.candidates[0];

      if ((matchResult.confidence === 'EXACT' || matchResult.confidence === 'HIGH') && topCandidate) {
        canonicalGameId = topCandidate.canonicalGameId;
        canonicalGamesLinked += 1;
      } else if (matchResult.confidence === 'UNLINKED' || ((matchResult.confidence === 'EXACT' || matchResult.confidence === 'HIGH') && !topCandidate)) {
        // The `!topCandidate` arm is structurally unreachable given
        // matchProviderRecordToCanonical's own invariants (EXACT/HIGH always
        // carries at least one candidate) — handled explicitly rather than
        // silently falling into the POSSIBLE/AMBIGUOUS candidate-only branch
        // below, which would be the wrong outcome for this confidence level.
        canonicalGameId = await mintCatalogCanonicalId(normalizedTitle);
        canonicalGamesCreated += 1;
      } else {
        // POSSIBLE/AMBIGUOUS: Mission 9 — candidate rows ONLY, never an
        // authoritative link, never a "pick candidates[0]" fallback.
        canonicalGameId = await mintCatalogCanonicalId(`${normalizedTitle}::${record.provider}::${record.providerGameId}`);
        for (const candidate of matchResult.candidates) {
          statements.push(
            db
              .prepare(
                `INSERT INTO canonical_provider_link_candidates (provider, provider_game_id, candidate_canonical_game_id, confidence, evidence_json, observed_at)
                 VALUES (?,?,?,?,?,?)
                 ON CONFLICT(provider, provider_game_id, candidate_canonical_game_id) DO UPDATE SET
                   confidence=excluded.confidence, evidence_json=excluded.evidence_json, observed_at=excluded.observed_at`,
              )
              .bind(record.provider, record.providerGameId, candidate.canonicalGameId, matchResult.confidence, JSON.stringify(matchResult.candidates), nowMs),
          );
          candidatesRecorded += 1;
        }
      }
    }

    if (effectiveConfidence === 'EXACT' || effectiveConfidence === 'HIGH' || effectiveConfidence === 'UNLINKED') {
      statements.push(
        db
          .prepare(
            `INSERT INTO canonical_provider_links (provider, provider_game_id, canonical_game_id, confidence, evidence_json, linked_at)
             VALUES (?,?,?,?,?,?)
             ON CONFLICT(provider, provider_game_id) DO UPDATE SET
               canonical_game_id=excluded.canonical_game_id, confidence=excluded.confidence, evidence_json=excluded.evidence_json, linked_at=excluded.linked_at`,
          )
          .bind(record.provider, record.providerGameId, canonicalGameId, effectiveConfidence, JSON.stringify(evidenceForLink), nowMs),
      );

      // Upsert into discovery_catalog_entries, merging this provider's id
      // into the existing providerIds map. Bumps the GLOBAL sync_state
      // revision (client-facing delta cursor, unchanged Phase 2 design) —
      // only on a row that actually changed content.
      // Column order and bind-param order below are kept in one explicit
      // 1:1 list (no interleaved literals like `0,0`) specifically to avoid
      // a silent off-by-one column/value shift — a real bug caught here
      // during testing: an earlier draft of this statement was missing the
      // tags_json placeholder, which shifted trainer_available through
      // last_seen_in_sync_at each one column to the right and caused every
      // ingest call to 500. Every column has its own named `?` line now.
      statements.push(
        db
          .prepare(
            `INSERT INTO discovery_catalog_entries (
               solith_game_id,
               title,
               normalized_title,
               aliases_json,
               provider_ids_json,
               type,
               release_date,
               release_year,
               genres_json,
               tags_json,
               trainer_available,
               ct_available,
               updated_at,
               revision,
               lifecycle_status,
               last_seen_in_sync_at
             )
             VALUES (
               ?,
               ?,
               ?,
               ?,
               json_patch(COALESCE((SELECT provider_ids_json FROM discovery_catalog_entries WHERE solith_game_id = ?), '{}'), json_object(?, ?)),
               ?,
               ?,
               ?,
               ?,
               ?,
               0,
               0,
               ?,
               (SELECT COALESCE(MAX(revision), 0) + 1 FROM discovery_catalog_entries),
               'ACTIVE',
               ?
             )
             ON CONFLICT(solith_game_id) DO UPDATE SET
               provider_ids_json = json_patch(discovery_catalog_entries.provider_ids_json, json_object(?, ?)),
               updated_at = excluded.updated_at,
               revision = (SELECT COALESCE(MAX(revision), 0) + 1 FROM discovery_catalog_entries),
               lifecycle_status = 'ACTIVE',
               last_seen_in_sync_at = excluded.last_seen_in_sync_at`,
          )
          .bind(
            canonicalGameId, // solith_game_id
            record.title, // title
            normalizedTitle, // normalized_title
            '[]', // aliases_json
            canonicalGameId, // provider_ids_json: json_patch subquery lookup key
            record.provider, // provider_ids_json: json_object key
            record.providerGameId, // provider_ids_json: json_object value
            record.type, // type
            record.releaseDate ?? null, // release_date
            record.releaseDate ? Number(record.releaseDate.slice(0, 4)) : null, // release_year
            JSON.stringify(record.genres ?? []), // genres_json
            JSON.stringify(record.tags ?? []), // tags_json
            nowMs, // updated_at
            nowMs, // last_seen_in_sync_at
            record.provider, // ON CONFLICT provider_ids_json: json_object key
            record.providerGameId, // ON CONFLICT provider_ids_json: json_object value
          ),
      );
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO provider_sync_status (provider, last_attempt_at, last_success_at, last_revision, last_record_count, status, error_code, error_summary)
         VALUES (?,?,?,?,?,?,NULL,NULL)
         ON CONFLICT(provider) DO UPDATE SET
           last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, last_revision=excluded.last_revision,
           last_record_count=excluded.last_record_count, status='OK', error_code=NULL, error_summary=NULL`,
      )
      .bind(batch.provider, nowMs, nowMs, batch.providerRevision ?? null, batch.records.length, 'OK'),
  );

  statements.push(
    db
      .prepare(`INSERT INTO ingest_batch_log (provider, sync_id, applied_at, record_count, batch_hash) VALUES (?,?,?,?,?)`)
      .bind(batch.provider, batch.syncId, nowMs, batch.records.length, batchHash),
  );

  // Bug found via the real Mission 17 E2E (tests/backend-ingest-e2e.test.ts
  // step 10): GET /catalog/sync's `currentGlobalRevision` (index.ts) reads
  // sync_state.catalog_revision, NOT MAX(discovery_catalog_entries.revision)
  // — but nothing in this ingest path was actually updating sync_state, so
  // the delta cursor stayed frozen at its Phase 2 seed value forever,
  // silently re-including already-synced rows in every subsequent
  // non-truncated /catalog/sync response. sync_state.catalog_revision is
  // recomputed from the table's own actual MAX(revision) — never
  // hand-incremented — so this can never regress or drift out of sync with
  // the rows it describes.
  if (recordsApplied > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE sync_state SET catalog_revision = (SELECT COALESCE(MAX(revision), 0) FROM discovery_catalog_entries), updated_at = ? WHERE id = 'global'`,
        )
        .bind(nowMs),
    );
  }

  await db.batch(statements);

  let lifecycleEvaluation: IngestResult['lifecycleEvaluation'];
  if (batch.cycleComplete && batch.syncCycleId) {
    lifecycleEvaluation = await evaluateSyncCycleCompletion(db, batch.provider, batch.syncCycleId);
  }

  return {
    status: 'applied',
    provider: batch.provider,
    syncId: batch.syncId,
    recordsReceived: batch.records.length,
    recordsApplied,
    canonicalGamesCreated,
    canonicalGamesLinked,
    candidatesRecorded,
    ...(lifecycleEvaluation ? { lifecycleEvaluation } : {}),
  };
}

export async function handleIngestRequest(c: Context<{ Bindings: Bindings }>): Promise<Response> {
  const auth = authenticateIngestRequest(c);
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  let rawBody: unknown;
  try {
    const text = await c.req.text();
    if (text.length > MAX_REQUEST_BYTES) {
      return c.json({ error: 'payload_too_large' }, 413, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    }
    rawBody = JSON.parse(text);
  } catch {
    return c.json({ error: 'malformed_json' }, 400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  const parsed = providerCatalogBatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'invalid_batch', details: parsed.error.flatten() }, 400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }

  try {
    const result = await applyIngestBatch(c.env.DB, parsed.data);
    const status = result.status === 'rejected' ? 409 : 200;
    return c.json(result, status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  } catch (error) {
    // Server-side-only diagnostic (never sent to the client — see the
    // generic `ingest_failed` response below). Previously this catch block
    // recorded "see server logs" in provider_sync_status without anything
    // actually being logged anywhere, making every ingest failure silently
    // undiagnosable. Found while investigating a real 500 during the
    // Mission 18 scale E2E (tests/backend-ingest-scale-e2e.test.ts).
    console.error(JSON.stringify({ service: 'solith-catalog-backend', event: 'ingest_failed', message: error instanceof Error ? error.message : String(error) }));

    // Record the failure in provider_sync_status without ever including a
    // raw error string/stack in a client-visible response.
    try {
      await c.env.DB.prepare(
        `INSERT INTO provider_sync_status (provider, last_attempt_at, status, error_code, error_summary)
         VALUES (?,?,?,?,?)
         ON CONFLICT(provider) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, status='ERROR', error_code=excluded.error_code, error_summary=excluded.error_summary`,
      )
        .bind(parsed.data.provider, nowIso(), 'ERROR', 'ingest_failed', 'batch application failed — see server logs')
        .run();
    } catch {
      // Best-effort status write; the original error below is what matters to the caller.
    }
    return c.json({ error: 'ingest_failed' }, 500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  }
}

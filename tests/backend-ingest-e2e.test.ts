/**
 * SOLITH Phase 3.2 Mission 17 — REAL backend provider-ingest E2E.
 *
 * ============================================================================
 * Unlike solith-catalog-backend/test/ingest.test.ts (which runs the ingest
 * routes IN-PROCESS inside @cloudflare/vitest-pool-workers), this file spawns
 * a REAL `wrangler dev --local` child process (same technique as
 * tests/real-backend-e2e.test.ts's Phase 2 proof) and drives the Phase 3.2
 * ingest endpoints through REAL HTTP calls against a REAL local D1 SQLite
 * database. Verification of rows the public API does not expose (e.g. raw
 * provider_catalog_records.last_updated, used for the rollback-guard proof)
 * uses `wrangler d1 execute --local --json`, the exact same real-tooling
 * technique this file's beforeAll already uses to apply migrations — never a
 * direct in-process DB import, since the whole point is proving the
 * spawned-process HTTP path end to end.
 *
 * INGEST_TOKEN is passed to the spawned process via `wrangler dev --var`
 * (plain local-dev var, not a real secret) so no `.dev.vars` file needs to
 * be created or cleaned up on disk.
 *
 * Each run gets its OWN local D1 persistence directory via `--persist-to`
 * (a fresh mkdtemp), rather than sharing solith-catalog-backend/.wrangler's
 * project-level state. Found necessary after tests/backend-ingest-scale-
 * e2e.test.ts (Mission 18) started sharing that same project-level D1 file:
 * its 10,050 inserted rows sorted ahead of this file's fixtures within
 * GET /catalog/sync's MAX_SYNC_ROWS_PER_TABLE=500 cap on `since=0`, making
 * this file's own rows silently fall outside the first page. Fixture
 * identifiers are still namespaced with a per-run random suffix as
 * defense in depth even though each run now starts from an empty database.
 * ============================================================================
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { fetchSyncManifest } from '../src/core/sync-manifest/client.ts';
import { realSyncManifestFetchImpl } from '../src/core/sync-manifest/http-fetch-impl.ts';
import type { SyncManifestDelta } from '../src/core/sync-manifest/types.ts';

const BACKEND_DIR = path.join(import.meta.dirname, '..', 'solith-catalog-backend');
const READINESS_TIMEOUT_MS = 30_000;
const INGEST_TOKEN = 'e2e-real-ingest-token-do-not-use-in-prod';
const RUN_ID = crypto.randomBytes(4).toString('hex');

let backendProcess: ChildProcessWithoutNullStreams | undefined;
let backendPort: number;
let backendBaseUrl: string;
let backendStdout: string[] = [];
let persistDir: string;

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('could not determine free port')));
      }
    });
  });
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = (await response.json()) as { status: string };
        if (body.status === 'healthy') return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms: ${String(lastError)}`);
}

/** See tests/real-backend-e2e.test.ts's identical helper for the `shell:true` / tree-kill rationale on Windows. */
async function killBackendProcessTree(): Promise<void> {
  if (!backendProcess || backendProcess.killed || backendProcess.pid === undefined) return;
  const pid = backendProcess.pid;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe' });
    } catch {
      /* already exited, or nothing left to kill — fine either way */
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      backendProcess.kill('SIGKILL');
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

interface IngestResponse {
  status: 'applied' | 'idempotent-replay' | 'rejected';
  provider: string;
  syncId: string;
  recordsReceived: number;
  recordsApplied: number;
  canonicalGamesCreated: number;
  canonicalGamesLinked: number;
  candidatesRecorded: number;
  reason?: string;
}

async function postIngest(
  provider: string,
  body: unknown,
  token: string = INGEST_TOKEN,
): Promise<{ httpStatus: number; json: unknown }> {
  const response = await fetch(`${backendBaseUrl}/internal/ingest/${provider}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { httpStatus: response.status, json };
}

/**
 * Real read against the actual local D1 SQLite file via wrangler's own CLI —
 * not a mock, not an in-process DB import. Uses `--file` (a temp .sql file)
 * rather than `--command <sql>`: on Windows, execFileSync's `shell: true`
 * mode hands the argv array to cmd.exe without reliably quoting elements
 * containing spaces, so a `--command` value with spaces/quotes gets
 * word-split into bogus extra CLI arguments ("Unknown arguments: ..."),
 * discovered by running this exact query against the real CLI.
 */
function d1QueryLocal<T = Record<string, unknown>>(sql: string): T[] {
  const sqlFile = path.join(os.tmpdir(), `solith-e2e-d1-query-${crypto.randomBytes(6).toString('hex')}.sql`);
  fs.writeFileSync(sqlFile, sql, 'utf-8');
  try {
    const output = execFileSync('npx', ['wrangler', 'd1', 'execute', 'solith-catalog-db', '--local', '--persist-to', persistDir, '--json', '--file', sqlFile], {
      cwd: BACKEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      encoding: 'utf-8',
    });
    const parsed = JSON.parse(output) as Array<{ results: T[] }>;
    return parsed[0]?.results ?? [];
  } finally {
    fs.rmSync(sqlFile, { force: true });
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// Fixture identifiers — namespaced per run so repeated local runs never collide.
const SHARED_TITLE = `E2E Shared Title ${RUN_ID}`;
const EXCLUSIVE_TITLE = `E2E GOG Exclusive ${RUN_ID}`;
const AMBIGUOUS_TITLE = `E2E Ambiguous Title ${RUN_ID}`;
const SHARED_PUBLISHER = `E2E Shared Publisher ${RUN_ID}`;

const steamSharedId = `e2e-${RUN_ID}-steam-shared`;
const epicSharedId = `e2e-${RUN_ID}-epic-shared`;
const gogExclusiveId = `e2e-${RUN_ID}-gog-exclusive`;
const steamAmbigId = `e2e-${RUN_ID}-steam-ambig`;
const epicAmbigId = `e2e-${RUN_ID}-epic-ambig`;

let firstIngestResult: { steam: IngestResponse; epic: IngestResponse; gog: IngestResponse };
let revisionAfterFirstIngest: string;

// Fixed at module load so the exact same batch object can be resubmitted
// later byte-for-byte (step 11's genuine idempotent-replay proof) — using
// isoNow() freshly at each call site would make every "identical" resend
// actually carry a different lastUpdated/content hash.
const steamSharedBatch = {
  provider: 'steam',
  syncId: `${RUN_ID}-steam-1`,
  observedAt: isoNow(),
  records: [
    { provider: 'steam', providerGameId: steamSharedId, title: SHARED_TITLE, type: 'game', publisher: SHARED_PUBLISHER, lastUpdated: isoNow() },
    { provider: 'steam', providerGameId: steamAmbigId, title: AMBIGUOUS_TITLE, type: 'game', lastUpdated: isoNow() },
  ],
};

describe('REAL backend provider-ingest E2E — Phase 3.2 Mission 17 (wrangler dev --local + real D1, no mocks)', () => {
  beforeAll(async () => {
    backendPort = await findFreePort();
    backendBaseUrl = `http://127.0.0.1:${backendPort}`;
    persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ingest-e2e-d1-'));

    execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'solith-catalog-db', '--local', '--persist-to', persistDir], {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    backendProcess = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--local',
        '--port',
        String(backendPort),
        '--persist-to',
        persistDir,
        '--var',
        `INGEST_TOKEN:${INGEST_TOKEN}`,
      ],
      { cwd: BACKEND_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    backendProcess.stdout.on('data', (chunk: Buffer) => backendStdout.push(chunk.toString('utf-8')));
    backendProcess.stderr.on('data', (chunk: Buffer) => backendStdout.push(chunk.toString('utf-8')));

    await waitForHealthy(backendBaseUrl, READINESS_TIMEOUT_MS);
  });

  afterAll(async () => {
    await killBackendProcessTree();
    try {
      fs.rmSync(persistDir, { recursive: true, force: true });
    } catch {
      /* best-effort scratch cleanup */
    }
  });

  test('step 1: wrangler dev --local started a real Workers runtime with INGEST_TOKEN configured, no Cloudflare account login required', () => {
    // waitForHealthy resolving already proves a real local HTTP server answered
    // a real GET /health. The --var flag above is the ONLY place INGEST_TOKEN
    // is set for this process — no .dev.vars file, no account/zone config.
    assert.ok(backendBaseUrl.startsWith('http://127.0.0.1:'));
  });

  test('step 2: authenticate internal provider ingest — missing/wrong token rejected, correct token accepted', async () => {
    const noAuth = await fetch(`${backendBaseUrl}/internal/ingest/steam`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noAuth.status, 401);

    const wrongAuth = await postIngest('steam', {}, 'not-the-real-token');
    assert.equal(wrongAuth.httpStatus, 401);

    // A syntactically valid-but-empty-records batch with the CORRECT token
    // should pass auth and fail on schema (empty records array is allowed by
    // the schema — min length is not enforced on records — so this just
    // proves auth succeeds and the request reaches validation/application).
    const authedEmpty = await postIngest('steam', {
      provider: 'steam',
      syncId: `${RUN_ID}-steam-authcheck`,
      observedAt: isoNow(),
      records: [],
    });
    assert.equal(authedEmpty.httpStatus, 200);
  });

  test('step 3: ingest Steam fixture (shared-title game, with publisher)', async () => {
    const { httpStatus, json } = await postIngest('steam', steamSharedBatch);
    assert.equal(httpStatus, 200);
    const result = json as IngestResponse;
    assert.equal(result.status, 'applied');
    assert.equal(result.recordsApplied, 2);
    // Neither record has an existing candidate yet (first provider to ingest
    // either title this run) — both mint their own canonical game.
    assert.equal(result.canonicalGamesCreated, 2);
    firstIngestResult = { steam: result } as typeof firstIngestResult;
  });

  test('step 4: ingest Epic fixture (same shared title + same publisher as Steam; distinct ambiguous-title record with NO publisher)', async () => {
    const { httpStatus, json } = await postIngest('epic', {
      provider: 'epic',
      syncId: `${RUN_ID}-epic-1`,
      observedAt: isoNow(),
      records: [
        {
          provider: 'epic',
          providerGameId: epicSharedId,
          title: SHARED_TITLE,
          type: 'game',
          publisher: SHARED_PUBLISHER,
          lastUpdated: isoNow(),
        },
        {
          provider: 'epic',
          providerGameId: epicAmbigId,
          title: AMBIGUOUS_TITLE,
          type: 'game',
          lastUpdated: isoNow(),
        },
      ],
    });
    assert.equal(httpStatus, 200);
    const result = json as IngestResponse;
    assert.equal(result.status, 'applied');
    firstIngestResult.epic = result;
  });

  test('step 5: ingest GOG fixture (exclusive title, no other provider has it)', async () => {
    const { httpStatus, json } = await postIngest('gog', {
      provider: 'gog',
      syncId: `${RUN_ID}-gog-1`,
      observedAt: isoNow(),
      records: [
        {
          provider: 'gog',
          providerGameId: gogExclusiveId,
          title: EXCLUSIVE_TITLE,
          type: 'game',
          lastUpdated: isoNow(),
        },
      ],
    });
    assert.equal(httpStatus, 200);
    const result = json as IngestResponse;
    assert.equal(result.status, 'applied');
    assert.equal(result.canonicalGamesCreated, 1);
    firstIngestResult.gog = result;
  });

  test('step 6: canonical merge for shared-title/shared-publisher game — verified conservative, NOT auto-merged (no curated alias exists)', () => {
    // The production KNOWN_PROVIDER_ALIASES list starts EMPTY by design (see
    // src/shared/edition-registry.ts's README — never a fabricated real-world
    // ID). Without a curated alias, "same normalized title + same publisher"
    // is only POSSIBLE evidence (Phase 3.1's P1 security fix demoted this
    // from HIGH), never EXACT/HIGH. So Epic's shared-title record must have
    // recorded a CANDIDATE against Steam's canonical game, not an
    // authoritative link/merge. This is the intended security-conservative
    // behavior — asserting an actual auto-merge here would be asserting a
    // regression of the P1 fix, not a feature.
    assert.equal(firstIngestResult.epic.canonicalGamesLinked, 0);
    assert.ok(firstIngestResult.epic.candidatesRecorded >= 1, 'Epic shared-title record should have recorded at least one POSSIBLE candidate against the Steam canonical game');
    // A POSSIBLE/AMBIGUOUS match never writes an authoritative
    // canonical_provider_links row for that record at all (Mission 9:
    // "candidate rows ONLY") — so canonicalGamesCreated stays 0 for this
    // record too. It is not "merged", but it is also not independently
    // minted as its own linked canonical game the way an UNLINKED record is.
    assert.equal(firstIngestResult.epic.canonicalGamesCreated, 0);
  });

  test('step 7: preserve exclusives — GOG-only title got its own canonical game, unaffected by Steam/Epic ingests', () => {
    const rows = d1QueryLocal<{ canonical_game_id: string; confidence: string }>(
      `SELECT canonical_game_id, confidence FROM canonical_provider_links WHERE provider='gog' AND provider_game_id='${gogExclusiveId}'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.confidence, 'UNLINKED');
  });

  test('step 8: preserve ambiguous candidates — same-title-no-publisher records from Steam+Epic both recorded as candidates, never silently merged', () => {
    const steamCandidates = d1QueryLocal(
      `SELECT * FROM canonical_provider_link_candidates WHERE provider='steam' AND provider_game_id='${steamAmbigId}'`,
    );
    const epicCandidates = d1QueryLocal(
      `SELECT * FROM canonical_provider_link_candidates WHERE provider='epic' AND provider_game_id='${epicAmbigId}'`,
    );
    // Steam ingested first with no prior candidates for this title -> UNLINKED (mints its own game).
    // Epic ingested second and found Steam's title-only match -> POSSIBLE candidate, not a merge.
    assert.ok(epicCandidates.length >= 1, 'Epic ambiguous-title record should have been recorded as a candidate, never auto-merged into Steam\'s canonical game');
    const steamLinks = d1QueryLocal<{ confidence: string }>(
      `SELECT confidence FROM canonical_provider_links WHERE provider='steam' AND provider_game_id='${steamAmbigId}'`,
    );
    assert.equal(steamLinks[0]?.confidence, 'UNLINKED');
  });

  test('step 9: Discovery query (GET /catalog/sync) returns the expected canonical records', async () => {
    const response = await fetch(`${backendBaseUrl}/catalog/sync?since=0`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { catalogRevision: string; changedCatalogEntries: Array<{ title: string; provider_ids_json?: string; providerIds?: Record<string, string> }> };
    revisionAfterFirstIngest = body.catalogRevision;
    const titles = body.changedCatalogEntries.map((e) => e.title);
    assert.ok(titles.includes(SHARED_TITLE), 'shared title missing from sync response');
    assert.ok(titles.includes(EXCLUSIVE_TITLE), 'exclusive title missing from sync response');
    assert.ok(titles.includes(AMBIGUOUS_TITLE), 'ambiguous title missing from sync response');
  });

  test('step 10: delta endpoint (GET /catalog/sync?since=<prior revision>) returns only newly-ingested changes', async () => {
    const newTitle = `E2E Delta Addition ${RUN_ID}`;
    const newId = `e2e-${RUN_ID}-steam-delta`;
    const { httpStatus, json } = await postIngest('steam', {
      provider: 'steam',
      syncId: `${RUN_ID}-steam-delta`,
      observedAt: isoNow(),
      records: [{ provider: 'steam', providerGameId: newId, title: newTitle, type: 'game', lastUpdated: isoNow() }],
    });
    assert.equal(httpStatus, 200);
    assert.equal((json as IngestResponse).status, 'applied');

    const response = await fetch(`${backendBaseUrl}/catalog/sync?since=${revisionAfterFirstIngest}`);
    const body = (await response.json()) as { changedCatalogEntries: Array<{ title: string }> };
    const titles = body.changedCatalogEntries.map((e) => e.title);
    assert.ok(titles.includes(newTitle), 'delta response missing the newly-ingested title');
    assert.ok(!titles.includes(SHARED_TITLE), 'delta response should not re-include an already-synced title');
  });

  test('step 11a: repeat identical batch — byte-identical resubmission (same syncId, same content) recognized as idempotent replay', async () => {
    // Reuses the EXACT same object from step 3 (same syncId, same record
    // fields including lastUpdated) — observedAt is excluded from the
    // content hash by design (batchContentHash hashes only {provider,
    // records}), so this proves true byte-identical-content idempotency,
    // not just a same-syncId short-circuit.
    const { httpStatus, json } = await postIngest('steam', steamSharedBatch);
    assert.equal(httpStatus, 200);
    const result = json as IngestResponse;
    assert.equal(result.status, 'idempotent-replay');
    assert.equal(result.recordsApplied, 0);
  });

  test('step 11b: repeat with same syncId but DIFFERENT content — rejected as a conflict, never silently overwritten', async () => {
    const { httpStatus, json } = await postIngest('steam', {
      ...steamSharedBatch,
      records: [{ provider: 'steam', providerGameId: steamSharedId, title: SHARED_TITLE, type: 'game', publisher: 'A DIFFERENT PUBLISHER', lastUpdated: isoNow() }],
    });
    assert.equal(httpStatus, 409);
    assert.equal((json as IngestResponse).status, 'rejected');
  });

  test('step 12: no duplicates — neither resubmission created a second canonical entry for the same title', () => {
    const rows = d1QueryLocal(`SELECT solith_game_id FROM discovery_catalog_entries WHERE title='${SHARED_TITLE.replace(/'/g, "''")}'`);
    assert.equal(rows.length, 1, 'exactly one discovery_catalog_entries row should exist for the shared title, not duplicated by the rejected resubmission');
  });

  test('step 13: attempt stale revision — an older last_updated than what is already stored', async () => {
    const staleId = `e2e-${RUN_ID}-steam-stale`;
    const freshUpdate = isoNow();
    await postIngest('steam', {
      provider: 'steam',
      syncId: `${RUN_ID}-steam-stale-fresh`,
      observedAt: isoNow(),
      records: [{ provider: 'steam', providerGameId: staleId, title: `E2E Stale Test ${RUN_ID}`, type: 'game', publisher: 'Fresh Publisher', lastUpdated: freshUpdate }],
    });

    const { httpStatus, json } = await postIngest('steam', {
      provider: 'steam',
      syncId: `${RUN_ID}-steam-stale-old`,
      observedAt: isoNow(),
      records: [{ provider: 'steam', providerGameId: staleId, title: `E2E Stale Test ${RUN_ID}`, type: 'game', publisher: 'STALE Publisher (should never be stored)', lastUpdated: isoDaysAgo(30) }],
    });
    // The HTTP call itself succeeds (200 applied) — the rollback guard lives
    // in the SQL WHERE clause on the provider_catalog_records upsert, not as
    // an application-level rejection. "rejected" (step 14) means the write
    // had no effect, not that the HTTP request itself errors.
    assert.equal(httpStatus, 200);
    assert.equal((json as IngestResponse).status, 'applied');

    const rows = d1QueryLocal<{ publisher: string; last_updated: string }>(
      `SELECT publisher, last_updated FROM provider_catalog_records WHERE provider='steam' AND provider_game_id='${staleId}'`,
    );
    assert.equal(rows.length, 1);
    // step 14: rejected — the stale write must NOT have overwritten the fresh row.
    assert.equal(rows[0]!.publisher, 'Fresh Publisher', 'stale (older last_updated) resubmission must not roll back a newer stored value');
    assert.equal(rows[0]!.last_updated, freshUpdate);
  });

  test('step 15: simulate provider failure — a malformed Epic batch is rejected before any DB write', async () => {
    const { httpStatus, json } = await postIngest('epic', {
      provider: 'epic',
      syncId: `${RUN_ID}-epic-malformed`,
      observedAt: isoNow(),
      records: [{ provider: 'epic', providerGameId: 'x', title: 'x', type: 'game', lastUpdated: isoNow(), unknownField: 'should be rejected by .strict()' }],
    });
    assert.equal(httpStatus, 400);
    assert.equal((json as { error: string }).error, 'invalid_batch');
  });

  test('step 16: existing data remains — Steam and GOG rows are untouched by Epic\'s rejected batch', async () => {
    const response = await fetch(`${backendBaseUrl}/catalog/sync?since=0`);
    const body = (await response.json()) as { changedCatalogEntries: Array<{ title: string }> };
    const titles = body.changedCatalogEntries.map((e) => e.title);
    assert.ok(titles.includes(SHARED_TITLE));
    assert.ok(titles.includes(EXCLUSIVE_TITLE));

    const statusResponse = await fetch(`${backendBaseUrl}/provider-sync/status`);
    const statusBody = (await statusResponse.json()) as { providers: Array<{ provider: string; status: string }> };
    const steamStatus = statusBody.providers.find((p) => p.provider === 'steam');
    assert.equal(steamStatus?.status, 'OK', 'Steam\'s own sync status must remain OK — unaffected by an unrelated Epic validation failure');
  });

  test('step 17: desktop read client fetches a page via the real client vendor-abstraction (fetchSyncManifest + realSyncManifestFetchImpl)', async () => {
    const result = await fetchSyncManifest({
      service: 'solith-catalog',
      endpointUrl: `${backendBaseUrl}/catalog/sync`,
      fetchImpl: realSyncManifestFetchImpl,
    });
    assert.ok(!('error' in result), `sync must succeed: ${JSON.stringify(result)}`);
    const delta = result as SyncManifestDelta;
    assert.ok((delta.changedCatalogEntries as Array<{ title: string }>).some((e) => e.title === SHARED_TITLE));
  });

  test('step 18: no write credential reaches the desktop — INGEST_TOKEN never appears in any client-visible response', async () => {
    const syncResponse = await fetch(`${backendBaseUrl}/catalog/sync?since=0`);
    const syncText = await syncResponse.text();
    assert.ok(!syncText.includes(INGEST_TOKEN));

    const statusResponse = await fetch(`${backendBaseUrl}/provider-sync/status`);
    const statusText = await statusResponse.text();
    assert.ok(!statusText.includes(INGEST_TOKEN));

    const badAuthResponse = await fetch(`${backendBaseUrl}/internal/ingest/steam`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const badAuthText = await badAuthResponse.text();
    assert.ok(!badAuthText.includes(INGEST_TOKEN));
  });
});

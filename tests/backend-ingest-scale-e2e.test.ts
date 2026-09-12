/**
 * SOLITH Phase 3.2 Mission 18 — large backend ingest E2E through the ACTUAL
 * HTTP/backend path (not direct DB calls), at real scale.
 *
 * Same real `wrangler dev --local` + real local D1 technique as
 * tests/backend-ingest-e2e.test.ts (Mission 17), but this file's only
 * purpose is scale measurement: ingest 10,000 provider records through
 * BOUNDED batches (MAX_RECORDS_PER_BATCH, enforced server-side by
 * ingest-schema.ts — never one giant payload) and report real, measured
 * numbers — request/batch count, total ingest wall-clock time, D1 file
 * growth in bytes, and post-ingest query latency. No extrapolation: every
 * number below comes from an actual HTTP round trip against a real spawned
 * Workers runtime and a real on-disk SQLite-backed D1 database.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const BACKEND_DIR = path.join(import.meta.dirname, '..', 'solith-catalog-backend');
const READINESS_TIMEOUT_MS = 30_000;
const INGEST_TOKEN = 'e2e-scale-ingest-token-do-not-use-in-prod';
const RUN_ID = crypto.randomBytes(4).toString('hex');

// 134 batches x 75 records/batch = 10,050 — evenly divisible by the real
// per-batch cap while still satisfying Mission 18's "at minimum 10,000".
const TOTAL_RECORDS = 10_050;
// == MAX_RECORDS_PER_BATCH (see ingest-schema.ts). That constant itself was
// lowered from an originally-declared 2000 to 75 as a DIRECT finding of this
// test: 2000 (and even 150) silently 500s every real batch — D1 refuses a
// `db.batch()` call once its total bound-parameter count gets too large.
// 75 is the real, measured-safe bound; using anything else here would no
// longer be testing the limit that actually ships.
const RECORDS_PER_BATCH = 75;
const EXPECTED_BATCH_COUNT = TOTAL_RECORDS / RECORDS_PER_BATCH;

let backendProcess: ChildProcessWithoutNullStreams | undefined;
let backendPort: number;
let backendBaseUrl: string;
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

function buildBatch(provider: string, batchIndex: number, count: number) {
  const records = Array.from({ length: count }, (_, i) => {
    const n = batchIndex * RECORDS_PER_BATCH + i;
    return {
      provider,
      providerGameId: `e2e-scale-${RUN_ID}-${n}`,
      title: `E2E Scale Test Game ${RUN_ID} ${n}`,
      type: 'game' as const,
      developer: `Scale Test Studio ${n % 500}`,
      publisher: `Scale Test Publisher ${n % 250}`,
      releaseDate: '2020-01-01',
      genres: ['Action', 'Adventure'],
      tags: ['Singleplayer'],
      lastUpdated: new Date().toISOString(),
    };
  });
  return {
    provider,
    syncId: `${RUN_ID}-scale-batch-${batchIndex}`,
    observedAt: new Date().toISOString(),
    records,
  };
}

function findLocalD1SqliteFile(): string {
  const d1Dir = path.join(persistDir, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const files = fs.readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite'));
  assert.ok(files.length >= 1, 'expected at least one local D1 sqlite file after migrations were applied');
  // Pick the largest — metadata.sqlite (if present) is tiny; the real data file is not.
  return files
    .map((f) => path.join(d1Dir, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]!;
}

describe('REAL backend ingest SCALE E2E — Phase 3.2 Mission 18 (10,000 records via bounded batches, real HTTP, real D1)', () => {
  beforeAll(async () => {
    backendPort = await findFreePort();
    backendBaseUrl = `http://127.0.0.1:${backendPort}`;
    // Own local D1 persistence directory (fresh mkdtemp) rather than the
    // project-level .wrangler state shared with tests/backend-ingest-e2e.test.ts
    // (Mission 17) — running both against the same D1 file made Mission 17's
    // small fixture rows fall outside /catalog/sync's 500-row page once this
    // file's 10,050 rows sorted ahead of them by revision. Also gives this
    // scale measurement a guaranteed-empty starting byte count.
    persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-ingest-scale-e2e-d1-'));

    execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'solith-catalog-db', '--local', '--persist-to', persistDir], {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    backendProcess = spawn(
      'npx',
      ['wrangler', 'dev', '--local', '--port', String(backendPort), '--persist-to', persistDir, '--var', `INGEST_TOKEN:${INGEST_TOKEN}`],
      { cwd: BACKEND_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    backendProcess.stdout.on('data', () => {});
    backendProcess.stderr.on('data', () => {});

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

  test(`ingest ${TOTAL_RECORDS} steam records across ${EXPECTED_BATCH_COUNT} bounded batches of ${RECORDS_PER_BATCH} via real HTTP`, async () => {
    const d1FileBefore = findLocalD1SqliteFile();
    const bytesBefore = fs.statSync(d1FileBefore).size;

    const batchTimingsMs: number[] = [];
    const wallStart = Date.now();
    for (let b = 0; b < EXPECTED_BATCH_COUNT; b += 1) {
      const batch = buildBatch('steam', b, RECORDS_PER_BATCH);
      const body = JSON.stringify(batch);
      const batchStart = Date.now();
      const response = await fetch(`${backendBaseUrl}/internal/ingest/steam`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${INGEST_TOKEN}` },
        body,
      });
      const elapsed = Date.now() - batchStart;
      batchTimingsMs.push(elapsed);
      assert.equal(response.status, 200, `batch ${b} must succeed`);
      const result = (await response.json()) as { status: string; recordsApplied: number };
      assert.equal(result.status, 'applied');
      assert.equal(result.recordsApplied, RECORDS_PER_BATCH);
    }
    const totalIngestMs = Date.now() - wallStart;

    const d1FileAfter = findLocalD1SqliteFile();
    const bytesAfter = fs.statSync(d1FileAfter).size;
    const bytesGrown = bytesAfter - bytesBefore;

    const queryStart = Date.now();
    const syncResponse = await fetch(`${backendBaseUrl}/catalog/sync?since=0`);
    const queryMs = Date.now() - queryStart;
    assert.equal(syncResponse.status, 200);
    const syncBody = (await syncResponse.json()) as { changedCatalogEntries: unknown[] };
    // /catalog/sync caps a single response at MAX_SYNC_ROWS_PER_TABLE=500
    // rows regardless of how many total rows exist — this proves that cap is
    // actually honored under real 10k-row load, not just declared.
    assert.ok(syncBody.changedCatalogEntries.length <= 500);

    const rowsPerSec = Math.round((TOTAL_RECORDS / totalIngestMs) * 1000);

    console.log(
      JSON.stringify(
        {
          mission: 'Phase 3.2 Mission 18 — real backend ingest scale measurement',
          totalRecords: TOTAL_RECORDS,
          batchCount: EXPECTED_BATCH_COUNT,
          recordsPerBatch: RECORDS_PER_BATCH,
          totalIngestMs,
          rowsPerSec,
          perBatchMs: batchTimingsMs,
          d1BytesBefore: bytesBefore,
          d1BytesAfter: bytesAfter,
          d1BytesGrown: bytesGrown,
          postIngestSyncQueryMs: queryMs,
          syncResponseRowCountCappedAt500: syncBody.changedCatalogEntries.length,
        },
        null,
        2,
      ),
    );

    assert.ok(totalIngestMs > 0);
    assert.ok(bytesGrown > 0, 'local D1 file must have actually grown after ingesting 10,000 records');
  });
});

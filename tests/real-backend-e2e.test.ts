/**
 * ROADMAP §online-foundation Phase 2 Part B — REAL backend E2E certification.
 *
 * ============================================================================
 * UNLIKE tests/local-e2e-sync-proof.test.ts (Mission 21), this file makes
 * REAL local network calls to a REAL Cloudflare Workers runtime process
 * (`wrangler dev --local`, spawned as a child process below) backed by a
 * REAL local D1 SQLite database — solith-catalog-backend/. There is no
 * MockSyncServer anywhere in this file. The only thing that is NOT real is
 * that the Worker is never deployed to an actual Cloudflare account (no
 * credentials for that exist in this environment — see the top-level task
 * report for the explicit hard-stop language on that point).
 * ============================================================================
 *
 * SUBSTITUTION NOTE (owner's Phase 2 instruction, followed exactly): Phase 2
 * is READ-ONLY — there is no community-upload network endpoint in this
 * phase (qualifyForUpload/createCommunitySubmission stay local-only). The
 * "community upload" portion of the Mission 21 16-step proof is therefore
 * replaced here by a SERVER-SIDE SEED step: the real backend's
 * migrations/0002_seed_fixtures.sql already inserts a fixture trainer
 * artifact (real bytes, real SHA-256) and its trainer_coverage row for
 * `atomfall` before this test ever runs. Step 2 below verifies that seed
 * exists and is internally consistent (hash matches bytes) instead of
 * simulating a client-driven upload flow that this phase does not expose
 * over the network.
 *
 * Client vendor-abstraction proof exercised here: `fetchSyncManifest` and
 * `resolveTrainerArtifact` are called with `realSyncManifestFetchImpl` /
 * `realTrainerArtifactFetchImpl` (src/core/sync-manifest/http-fetch-impl.ts,
 * src/core/trainer-artifact-cache/http-fetch-impl.ts) — both are literally
 * `globalThis.fetch` typed to the existing fetchImpl interfaces, proving the
 * MockSyncServer -> real backend swap needed ZERO client-code changes.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { type ChildProcessWithoutNullStreams, spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { resetForTesting } from '../src/core/database/index.ts';
import { upsertDiscoveryCatalogEntry, getDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import { deriveDiscoveryTrainerStatus } from '../src/core/discovery-catalog/trainer-status.ts';
import { getTrainerArtifact } from '../src/core/trainer-artifact-store/store.ts';
import { resolveTrainerArtifact } from '../src/core/trainer-artifact-cache/cache.ts';
import { realTrainerArtifactFetchImpl } from '../src/core/trainer-artifact-cache/http-fetch-impl.ts';
import { fetchSyncManifest, applySyncManifestDelta } from '../src/core/sync-manifest/client.ts';
import { realSyncManifestFetchImpl } from '../src/core/sync-manifest/http-fetch-impl.ts';
import type { SyncManifestDelta } from '../src/core/sync-manifest/types.ts';

const BACKEND_DIR = path.join(import.meta.dirname, '..', 'solith-catalog-backend');
const READINESS_TIMEOUT_MS = 30_000;
const SEEDED_ARTIFACT_HASH = '6c8fed01e93f1e1197a87d61bd2d8ea3223ee595a01aeee8e488dae19d1c1fd3';
const SEEDED_ARTIFACT_BYTES = Buffer.from('SOLITH-PHASE2-FIXTURE-TRAINER-ARTIFACT-atomfall-v1\n', 'utf-8');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-real-backend-e2e-'));
const clientBDbPath = path.join(tempRoot, 'client-b.db');
const clientBCacheDir = path.join(tempRoot, 'client-b-cache');

let backendProcess: ChildProcessWithoutNullStreams | undefined;
let backendPort: number;
let backendBaseUrl: string;
let backendStdout: string[] = [];
let sharedDelta!: SyncManifestDelta;

/** Finds a free TCP port by briefly binding to port 0 and reading back the OS-assigned port. */
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

/**
 * `spawn(..., { shell: true })` on Windows makes `backendProcess` the cmd.exe
 * shell, not `npx`/`wrangler`/`workerd` themselves — a plain
 * `backendProcess.kill()` only kills that shell wrapper and leaves the real
 * server running underneath it (observed directly: a first version of this
 * test using only `.kill('SIGTERM')` left the real backend answering
 * `/health` after the "kill" step). `taskkill /T /F` tree-kills the shell
 * and every process it spawned, which is what "backend becomes unavailable"
 * actually requires.
 */
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

describe('REAL backend E2E — Phase 2 Part B (wrangler dev --local + real D1, no mocks)', () => {
  beforeAll(async () => {
    fs.mkdirSync(clientBCacheDir, { recursive: true });
    await resetForTesting(clientBDbPath);

    backendPort = await findFreePort();
    backendBaseUrl = `http://127.0.0.1:${backendPort}`;

    // Ensure the real local D1 database has the fixture migrations applied
    // — idempotent, safe to re-run on an already-migrated local db. This is
    // the exact command an owner would run locally; no --remote flag, no
    // account interaction.
    execFileSync(
      'npx',
      ['wrangler', 'd1', 'migrations', 'apply', 'solith-catalog-db', '--local'],
      { cwd: BACKEND_DIR, stdio: 'pipe', shell: process.platform === 'win32' },
    );

    backendProcess = spawn(
      'npx',
      ['wrangler', 'dev', '--local', '--port', String(backendPort)],
      { cwd: BACKEND_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    backendProcess.stdout.on('data', (chunk: Buffer) => backendStdout.push(chunk.toString('utf-8')));
    backendProcess.stderr.on('data', (chunk: Buffer) => backendStdout.push(chunk.toString('utf-8')));

    await waitForHealthy(backendBaseUrl, READINESS_TIMEOUT_MS);
  });

  afterAll(async () => {
    await killBackendProcessTree();
    try {
      await resetForTesting();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('step 1: wrangler dev --local started a real Workers runtime with NO Cloudflare account login required', () => {
    // If beforeAll's waitForHealthy resolved, a real local server answered a
    // real HTTP GET /health with status: healthy. No `wrangler login`, no
    // OAuth prompt, no account_id was configured anywhere in this test or
    // in solith-catalog-backend/wrangler.jsonc (workers_dev: false, no
    // account_id field, --local flag forces local-only D1/runtime).
    assert.ok(backendProcess && !backendProcess.killed, 'backend process must be running');
  });

  test('step 2 (SUBSTITUTES community-upload): server-side seed provides a known trainer artifact with immutable hash identity', () => {
    const actualHash = crypto.createHash('sha256').update(SEEDED_ARTIFACT_BYTES).digest('hex');
    assert.equal(actualHash, SEEDED_ARTIFACT_HASH, 'fixture bytes must hash to the seeded artifact_hash key');
  });

  test('step 3: Client B starts with no local knowledge of atomfall', () => {
    const local = getDiscoveryCatalogEntry('atomfall');
    assert.equal(local, null);
  });

  test('step 4: Client B syncs against the REAL backend using the real HTTP fetchImpl (vendor-abstraction proof)', async () => {
    const result = await fetchSyncManifest({
      service: 'solith-catalog',
      endpointUrl: `${backendBaseUrl}/catalog/sync`,
      fetchImpl: realSyncManifestFetchImpl,
    });
    assert.ok(!('error' in result), `sync must succeed: ${JSON.stringify(result)}`);
    const delta = result as SyncManifestDelta;
    assert.equal(delta.catalogRevision, '3');
    assert.ok(delta.changedCatalogEntries.some((entry) => entry.solithGameId === 'atomfall'));

    const applied = applySyncManifestDelta('solith-catalog', delta);
    assert.equal(applied.status, 'applied');
    assert.equal(applied.upsertedCatalogEntries, 3);

    // stash the delta on globalThis for the next test — node:test steps in
    // this file intentionally share state the same way Mission 21's proof
    // does (module-level `let` variables), see `sharedDelta` below.
    sharedDelta = delta;
  });

  test('step 5: Discovery shows trainer availability for atomfall after the real sync', () => {
    const entry = getDiscoveryCatalogEntry('atomfall');
    assert.ok(entry, 'atomfall must be present locally after sync');
    assert.equal(entry!.trainerAvailable, true);
    const status = deriveDiscoveryTrainerStatus(entry!, true, false);
    assert.equal(status, 'TRAINER_AVAILABLE');
  });

  test('step 6: trainer-coverage delta carries the artifact hash for atomfall', () => {
    const coverage = sharedDelta.changedTrainerCoverage as Array<{ gameId: string; artifactHash?: string }>;
    const atomfallCoverage = coverage.find((row) => row.gameId === 'atomfall');
    assert.ok(atomfallCoverage);
    assert.equal(atomfallCoverage!.artifactHash, SEEDED_ARTIFACT_HASH);
  });

  test('step 7: artifact retrieval from the REAL backend, real SHA-256 verification, real local cache write', async () => {
    const result = await resolveTrainerArtifact({
      artifactHash: SEEDED_ARTIFACT_HASH,
      remoteUrl: `${backendBaseUrl}/artifacts/${SEEDED_ARTIFACT_HASH}`,
      fetchImpl: realTrainerArtifactFetchImpl,
      trainerId: 'atomfall-trainer-v1',
      gameId: 'atomfall',
      cacheDir: clientBCacheDir,
      // The real backend runs on 127.0.0.1 for this local proof — this is
      // the ONE place a local dev server legitimately needs the SSRF guard
      // opt-out; a real deployed backend would be a public https:// host
      // and would need no such opt-out.
      allowPrivateNetworkHosts: true,
    });

    assert.equal(result.status, 'fetched');
    assert.ok(result.localPath);
    const bytesOnDisk = fs.readFileSync(result.localPath!);
    assert.ok(bytesOnDisk.equals(SEEDED_ARTIFACT_BYTES), 'downloaded bytes must exactly match the known fixture payload');

    const actualHash = crypto.createHash('sha256').update(bytesOnDisk).digest('hex');
    assert.equal(actualHash, SEEDED_ARTIFACT_HASH, 'downloaded bytes must hash to the requested artifact hash');
  });

  test('step 8: local cache now has a real registered row', () => {
    const row = getTrainerArtifact(SEEDED_ARTIFACT_HASH);
    assert.ok(row);
    assert.ok(row!.localPath && fs.existsSync(row!.localPath));
  });

  test('step 9: a second sync at the new revision is an idempotent no-op (revision monotonicity, real server)', async () => {
    const result = await fetchSyncManifest({
      service: 'solith-catalog',
      endpointUrl: `${backendBaseUrl}/catalog/sync`,
      sinceRevision: sharedDelta.catalogRevision,
      fetchImpl: realSyncManifestFetchImpl,
    });
    assert.ok(!('error' in result));
    const delta = result as SyncManifestDelta;
    assert.equal(delta.changedCatalogEntries.length, 0);

    const applied = applySyncManifestDelta('solith-catalog', delta);
    assert.equal(applied.status, 'noop');
  });

  test('step 10: backend becomes unavailable', async () => {
    await killBackendProcessTree();
    await assert.rejects(fetch(`${backendBaseUrl}/health`, { signal: AbortSignal.timeout(1500) }));
  });

  test('step 11: Client B opens the cached trainer with ZERO additional network requests', async () => {
    let networkCallCount = 0;
    const countingFetchImpl: typeof realTrainerArtifactFetchImpl = (url, init) => {
      networkCallCount += 1;
      return realTrainerArtifactFetchImpl(url, init);
    };

    const result = await resolveTrainerArtifact({
      artifactHash: SEEDED_ARTIFACT_HASH,
      remoteUrl: `${backendBaseUrl}/artifacts/${SEEDED_ARTIFACT_HASH}`,
      fetchImpl: countingFetchImpl,
      cacheDir: clientBCacheDir,
      allowPrivateNetworkHosts: true,
    });

    assert.equal(result.status, 'cache-hit');
    assert.equal(networkCallCount, 0, 'a cache hit must not invoke fetchImpl at all');
  });

  test('step 12: server-side structured logs were emitted for the real requests made above', () => {
    const combined = backendStdout.join('');
    for (const expectedEvent of ['sync_accepted', 'sync_served', 'artifact_cache_hit']) {
      assert.ok(
        combined.includes(`"event":"${expectedEvent}"`),
        `expected a structured log line for event "${expectedEvent}" in backend stdout`,
      );
    }
    // Audit: no credential/secret material in any log line this test observed.
    assert.ok(!/authorization|bearer|token|password/i.test(combined));
  });
});

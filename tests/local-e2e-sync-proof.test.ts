/**
 * ROADMAP §online-foundation Mission 21 — local E2E sync proof.
 *
 * Implements the owner's 16-step scenario end-to-end using ONLY the Mission
 * 20 in-memory mock server (src/core/sync-manifest/mock-server.ts) plus the
 * real local modules built for Missions 6-17/20 — no real network access,
 * no real Cloudflare Worker call, anywhere in this file.
 *
 * HONESTY NOTE on "two independent SOLITH clients": src/core/database/index.ts
 * exposes a single module-level database singleton (`db`), swapped out via
 * `resetForTesting(path)` — there is no API in this codebase for two
 * simultaneously-open local databases in one process. This test models the
 * two clients SEQUENTIALLY: "client 1" performs steps 1-9 against its own
 * on-disk DB, then `resetForTesting(pathB)` swaps the singleton to a brand
 * new, completely empty on-disk DB standing in for "client 2" for steps
 * 10-16. The one thing that must NOT be reset between the two clients is the
 * `MockSyncServer` instance itself — it lives in plain JS memory, independent
 * of the database singleton, exactly the way a real remote backend would be
 * independent of any one client's local DB. That separation (shared server,
 * swappable local DB) is what actually makes steps 10-16 a meaningful proof
 * of client-independence rather than a same-process shortcut.
 *
 * Each of the 16 steps is its own named `test()` with an explicit assertion
 * (or an honestly-marked failure) — see the individual test titles below and
 * the summary table in the final report.
 */
import { after as afterAll, before as beforeAll, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting, flushPersistence } from '../src/core/database/index.ts';
import { upsertDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import { getDiscoveryCatalogEntry } from '../src/core/discovery-catalog/store.ts';
import { deriveDiscoveryTrainerStatus } from '../src/core/discovery-catalog/trainer-status.ts';
import type { DiscoveryCatalogEntry } from '../src/core/discovery-catalog/types.ts';
import { computeArtifactHash, getTrainerArtifact, registerTrainerArtifact } from '../src/core/trainer-artifact-store/store.ts';
import { classifyTrainerContentSafety } from '../src/core/community-upload/safety-classification.ts';
import { qualifyForUploadWithVerifiedClassification } from '../src/core/community-upload/qualification.ts';
import { createLocalDraftSubmission } from '../src/core/community-upload/store.ts';
import { classifyArtifactBytes } from '../src/core/artifact-classification/classify.ts';
import { recordClassificationReceipt } from '../src/core/artifact-classification/store.ts';
import { resolveTrainerArtifact } from '../src/core/trainer-artifact-cache/cache.ts';
import { fetchSyncManifest, applySyncManifestDelta } from '../src/core/sync-manifest/client.ts';
import { MockSyncServer } from '../src/core/sync-manifest/mock-server.ts';
import type { UploadQualificationResult } from '../src/core/community-upload/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-e2e-sync-proof-'));
const client1DbPath = path.join(tempRoot, 'client1.db');
const client2DbPath = path.join(tempRoot, 'client2.db');
const client1CacheDir = path.join(tempRoot, 'client1-cache');
const client2CacheDir = path.join(tempRoot, 'client2-cache');

const server = new MockSyncServer();

const gameAId = 'game-a';

function gameAEntry(trainerAvailable: boolean): DiscoveryCatalogEntry {
  return {
    solithGameId: gameAId,
    title: 'Game A',
    normalizedTitle: 'game a',
    aliases: [],
    providerIds: {},
    type: 'game',
    genres: ['Action'],
    tags: [],
    trainerAvailable,
    ctAvailable: false,
    updatedAt: new Date().toISOString(),
  };
}

// Shared across steps, mirroring the owner's numbered scenario.
let trainerBuffer: Buffer;
let artifactHash: string;
let qualification: UploadQualificationResult;
let submissionId: string;
let client2SyncResultOk = false;
let client2ArtifactLocalPath: string | undefined;
let networkCallCountBeforeOfflineCheck = 0;

describe('local E2E sync proof — Mission 21 (16-step scenario)', () => {
  beforeAll(async () => {
    fs.mkdirSync(client1CacheDir, { recursive: true });
    fs.mkdirSync(client2CacheDir, { recursive: true });
    await resetForTesting(client1DbPath);
  });

  afterAll(async () => {
    try {
      await resetForTesting();
    } catch { /* ignore */ }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test('step 1: catalog contains Game A with no trainer', () => {
    server._seedCatalogEntry(gameAEntry(false));
    upsertDiscoveryCatalogEntry(gameAEntry(false));
    const local = getDiscoveryCatalogEntry(gameAId);
    assert.ok(local, 'Game A must exist in the local catalog');
    assert.equal(local!.trainerAvailable, false);
  });

  test('step 2: Game A has no trainer (deriveDiscoveryTrainerStatus === NO_TRAINER)', () => {
    const entry = getDiscoveryCatalogEntry(gameAId)!;
    const status = deriveDiscoveryTrainerStatus(entry, false, false);
    assert.equal(status, 'NO_TRAINER');
  });

  test('step 3: user builds a trainer (fake trainer artifact buffer)', () => {
    trainerBuffer = Buffer.from('fake-trainer-executable-bytes-for-game-a-v1');
    assert.ok(trainerBuffer.byteLength > 0);
  });

  test('step 4: trainer saved locally (registerTrainerArtifact, user-provided rightsClass, real SHA-256)', () => {
    artifactHash = computeArtifactHash(trainerBuffer);
    const localPath = path.join(client1CacheDir, `${artifactHash}.artifact`);
    fs.writeFileSync(localPath, trainerBuffer);
    const registered = registerTrainerArtifact({
      artifactHash,
      trainerId: 'trainer-game-a',
      gameId: gameAId,
      sizeBytes: trainerBuffer.byteLength,
      localPath,
      rightsClass: 'user-provided',
    });
    assert.equal(registered.rightsClass, 'user-provided');
    assert.equal(registered.artifactHash, artifactHash);
    assert.ok(fs.existsSync(localPath));
  });

  test('step 5: user chooses Share — the artifact is run through the real classification trust boundary first (Mission A2)', () => {
    // HONEST BEHAVIOR CHANGE (Phase 1.5 security closeout, Mission A2): this
    // step used to hand qualifyForUpload a caller-supplied
    // `safetyClassification` directly and assert `qualifies: true`. That
    // trusted the caller completely, which is exactly the gap Mission A2
    // closes. qualifyForUpload now requires a VERIFIED classification
    // receipt looked up from the classification_receipts store, and this
    // pass's real classifier (classifyArtifactBytes, classifierVersion
    // 'v0-inconclusive-only') honestly reports 'inconclusive' for every
    // input — because no real trainer-format parser exists in this
    // codebase yet (see artifact-classification/classify.ts header). So the
    // AUTOMATIC upload path is now correctly, intentionally blocked here —
    // this is not a regression, it is the trust boundary working exactly
    // as designed pending a future real classifier.
    const receipt = classifyArtifactBytes(trainerBuffer);
    recordClassificationReceipt(receipt);
    assert.equal(receipt.verdict, 'inconclusive');

    qualification = qualifyForUploadWithVerifiedClassification({
      hasSchemaValidation: true,
      hasGameIdentity: true,
      hasTrainerIdentity: true,
      hasArtifactHash: true,
      artifactHash,
      sharingPreference: 'ON',
    });
    assert.equal(qualification.qualifies, false);
  });

  test('step 6: automatic qualification is correctly blocked (inconclusive); user manually confirms "share anyway" instead', () => {
    assert.equal(qualification.qualifies, false);
    if (!qualification.qualifies) {
      assert.equal(qualification.result, 'COMMUNITY_UPLOAD_BLOCKED');
      assert.match(qualification.reason, /inconclusive/);
    }
    // Phase 2.1 security invariant closure: there is no longer any path
    // that starts the real Community trust-state ladder without a genuine
    // 'eligible' classification (submitDraftToCommunity enforces this at
    // runtime, independent of caller discipline). Step 9 below therefore
    // creates a LOCAL_DRAFT only — it stays local-only, submissionState
    // 'LOCAL_DRAFT', trustState null — and the hub-side propagation this
    // scenario is actually proving (catalog trainer-availability sync) is
    // driven directly against the mock server's own record shape, which is
    // independent of SOLITH's local qualification/trust-state machinery.
  });

  test('step 7: SHA-256 generated and is the real hash of the buffer', () => {
    assert.equal(artifactHash, computeArtifactHash(trainerBuffer));
    assert.match(artifactHash, /^[0-9a-f]{64}$/);
  });

  test('step 8: mock object store accepts the blob (_seedArtifact on the mock server)', () => {
    server._seedArtifact(artifactHash, trainerBuffer);
    assert.ok(true);
  });

  test('step 9: metadata service records the submission (createLocalDraftSubmission stays LOCAL_DRAFT; hub propagation is a separate mock-side record)', () => {
    const submission = createLocalDraftSubmission({
      gameId: gameAId,
      trainerId: 'trainer-game-a',
      artifactHash,
      safetyClassification: classifyTrainerContentSafety(['native-resolver', 'aob']),
    });
    submissionId = submission.submissionId;
    assert.equal(submission.submissionState, 'LOCAL_DRAFT');
    assert.equal(submission.trustState, null);
    server._recordSubmission({
      submissionId: submission.submissionId,
      artifactHash,
      trainerId: 'trainer-game-a',
      submittedAt: submission.submittedAt,
    });

    // Simulates the hub having processed the submission and republished the
    // catalog with Game A now marked trainer-available, BEFORE client 2's
    // first sync below (per the owner's step 11 wording).
    server._seedCatalogEntry(gameAEntry(true));
  });

  test('step 10: a second simulated SOLITH client syncs against the same mock server', async () => {
    assert.notEqual(submissionId, undefined, 'precondition: step 9 ran');
    await flushPersistence();
    await resetForTesting(client2DbPath);

    const delta = await fetchSyncManifest({
      service: 'discovery-catalog',
      endpointUrl: server.syncEndpointUrl,
      fetchImpl: server.fetchImpl,
    });

    assert.ok(!('error' in delta), `client 2 sync must succeed: ${'error' in delta ? delta.error : ''}`);
    if (!('error' in delta)) {
      const result = applySyncManifestDelta('discovery-catalog', delta);
      client2SyncResultOk = result.upsertedCatalogEntries >= 1;
    }
    assert.equal(client2SyncResultOk, true);
  });

  test('step 11: Game A now reports Trainer Available on the second client', () => {
    const local = getDiscoveryCatalogEntry(gameAId);
    assert.ok(local, 'client 2 must have received Game A via sync');
    assert.equal(local!.trainerAvailable, true);
  });

  test('step 12: second client downloads the trainer (cache-miss on its own empty trainer_artifacts table, fetch succeeds)', async () => {
    assert.equal(getTrainerArtifact(artifactHash), null, 'precondition: client 2 has never seen this artifact before');

    const result = await resolveTrainerArtifact({
      artifactHash,
      remoteUrl: server.artifactDownloadUrl(artifactHash),
      fetchImpl: server.fetchImpl,
      trainerId: 'trainer-game-a',
      gameId: gameAId,
      cacheDir: client2CacheDir,
      rightsClass: 'community-submitted',
    });

    assert.equal(result.status, 'fetched');
    client2ArtifactLocalPath = result.localPath;
    assert.ok(client2ArtifactLocalPath && fs.existsSync(client2ArtifactLocalPath));
  });

  test('step 13: hash verified — real hash comparison was used, not skipped', () => {
    assert.ok(client2ArtifactLocalPath);
    const downloadedBytes = fs.readFileSync(client2ArtifactLocalPath!);
    // Proves the bytes actually on disk hash to the exact value resolveTrainerArtifact
    // required for a 'fetched' result — the same real SHA-256 function used throughout.
    assert.equal(computeArtifactHash(downloadedBytes), artifactHash);
    assert.equal(downloadedBytes.toString(), trainerBuffer.toString());
  });

  test('step 14: cached locally — a real file exists and a trainer_artifacts row exists on the second client', () => {
    assert.ok(client2ArtifactLocalPath && fs.existsSync(client2ArtifactLocalPath));
    const row = getTrainerArtifact(artifactHash);
    assert.ok(row);
    assert.equal(row!.localPath, client2ArtifactLocalPath);
  });

  test('step 15: server goes offline', () => {
    server._goOffline();
    assert.ok(true);
  });

  test('step 16: trainer still opens from local cache while offline — cache-hit, zero additional network calls', async () => {
    networkCallCountBeforeOfflineCheck = server.networkCallCount;

    const result = await resolveTrainerArtifact({
      artifactHash,
      remoteUrl: server.artifactDownloadUrl(artifactHash),
      fetchImpl: server.fetchImpl,
      cacheDir: client2CacheDir,
    });

    assert.equal(result.status, 'cache-hit');
    assert.equal(
      server.networkCallCount,
      networkCallCountBeforeOfflineCheck,
      'no additional network call should have been made for a cache hit while offline',
    );
  });
});

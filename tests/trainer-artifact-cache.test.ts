/**
 * ROADMAP §online-foundation Mission 9 — local trainer-artifact cache tests.
 * Isolated from shared project data via resetForTesting() (:memory: sql.js),
 * following the trainer-artifact-store test precedent
 * (tests/trainer-artifact-store.test.ts).
 */
import { after as afterAll, before as beforeAll, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetForTesting } from '../src/core/database/index.ts';
import { computeArtifactHash, getTrainerArtifact, registerTrainerArtifact } from '../src/core/trainer-artifact-store/store.ts';
import { resolveTrainerArtifact } from '../src/core/trainer-artifact-cache/cache.ts';
import type { TrainerArtifactFetchImpl } from '../src/core/trainer-artifact-cache/types.ts';

function makeFetchImplReturning(buffer: Buffer): { fetchImpl: TrainerArtifactFetchImpl; calls: number[] } {
  const calls: number[] = [];
  const fetchImpl: TrainerArtifactFetchImpl = async () => {
    calls.push(Date.now());
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
    };
  };
  return { fetchImpl, calls };
}

describe('trainer artifact cache', () => {
  let cacheDir: string;

  beforeAll(async () => {
    await resetForTesting();
  });

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-artifact-cache-test-'));
  });

  afterAll(async () => {
    await resetForTesting();
  });

  test('cache-hit skips network entirely when a valid local file already exists', async () => {
    const buffer = Buffer.from('cache-hit-fixture-bytes');
    const hash = computeArtifactHash(buffer);
    const localPath = path.join(cacheDir, `${hash}.artifact`);
    fs.writeFileSync(localPath, buffer);
    registerTrainerArtifact({
      artifactHash: hash,
      trainerId: 'trainer-cache-hit',
      sizeBytes: buffer.byteLength,
      localPath,
      rightsClass: 'user-provided',
    });

    const { fetchImpl, calls } = makeFetchImplReturning(buffer);
    const result = await resolveTrainerArtifact({
      artifactHash: hash,
      remoteUrl: 'https://example.invalid/artifact',
      fetchImpl,
      cacheDir,
    });

    assert.equal(result.status, 'cache-hit');
    assert.equal(result.localPath, localPath);
    assert.equal(calls.length, 0, 'fetchImpl must never be invoked on a cache hit');
  });

  test('a cache miss triggers exactly one fetch and persists the artifact', async () => {
    const buffer = Buffer.from('cache-miss-fixture-bytes');
    const hash = computeArtifactHash(buffer);
    const { fetchImpl, calls } = makeFetchImplReturning(buffer);

    assert.equal(getTrainerArtifact(hash), null, 'precondition: no existing row for this hash');

    const result = await resolveTrainerArtifact({
      artifactHash: hash,
      remoteUrl: 'https://example.invalid/artifact',
      fetchImpl,
      trainerId: 'trainer-cache-miss',
      cacheDir,
    });

    assert.equal(result.status, 'fetched');
    assert.equal(calls.length, 1, 'fetchImpl must be invoked exactly once on a miss');
    assert.ok(result.localPath && fs.existsSync(result.localPath));
    assert.equal(fs.readFileSync(result.localPath!).toString(), buffer.toString());

    const row = getTrainerArtifact(hash);
    assert.ok(row);
    assert.equal(row!.localPath, result.localPath);
  });

  test('a hash mismatch is rejected and never persisted to disk or the store', async () => {
    const remoteBuffer = Buffer.from('tampered-or-corrupted-bytes');
    const claimedHash = computeArtifactHash(Buffer.from('what-the-caller-expected-instead'));
    const { fetchImpl, calls } = makeFetchImplReturning(remoteBuffer);

    const result = await resolveTrainerArtifact({
      artifactHash: claimedHash,
      remoteUrl: 'https://example.invalid/artifact',
      fetchImpl,
      cacheDir,
    });

    assert.equal(result.status, 'hash-mismatch');
    assert.equal(result.localPath, undefined);
    assert.equal(calls.length, 1);
    assert.equal(getTrainerArtifact(claimedHash), null, 'a mismatched download must never be registered');

    const expectedPath = path.join(cacheDir, `${claimedHash}.artifact`);
    assert.equal(fs.existsSync(expectedPath), false, 'a mismatched download must never be written to disk');
  });

  test('a stale row (DB says ok, but the local file was deleted) falls through to a real refetch instead of crashing', async () => {
    const buffer = Buffer.from('stale-row-fixture-bytes');
    const hash = computeArtifactHash(buffer);
    const localPath = path.join(cacheDir, `${hash}.artifact`);
    fs.writeFileSync(localPath, buffer);
    registerTrainerArtifact({
      artifactHash: hash,
      trainerId: 'trainer-stale-row',
      sizeBytes: buffer.byteLength,
      localPath,
      rightsClass: 'user-provided',
    });

    // Simulate disk loss out from under the DB row.
    fs.rmSync(localPath);
    assert.equal(fs.existsSync(localPath), false, 'precondition: file really is gone');

    const { fetchImpl, calls } = makeFetchImplReturning(buffer);
    const result = await resolveTrainerArtifact({
      artifactHash: hash,
      remoteUrl: 'https://example.invalid/artifact',
      fetchImpl,
      cacheDir,
    });

    assert.equal(result.status, 'fetched', 'must refetch rather than crash or falsely report a cache hit');
    assert.equal(calls.length, 1);
    assert.ok(result.localPath && fs.existsSync(result.localPath));
  });

  test('a network error from fetchImpl comes back as a typed result, never a thrown exception', async () => {
    const hash = computeArtifactHash(Buffer.from('unreachable-fixture'));
    const fetchImpl: TrainerArtifactFetchImpl = async () => {
      throw new Error('simulated network unreachable');
    };

    const result = await resolveTrainerArtifact({
      artifactHash: hash,
      remoteUrl: 'https://example.invalid/artifact',
      fetchImpl,
      cacheDir,
    });

    assert.equal(result.status, 'network-error');
    assert.ok(result.error && result.error.length > 0);
  });

  test('refuses a loopback/private-network remoteUrl by default (SSRF guard) without ever calling fetchImpl', async () => {
    const hash = computeArtifactHash(Buffer.from('ssrf-guard-fixture'));
    let called = false;
    const fetchImpl: TrainerArtifactFetchImpl = async () => {
      called = true;
      throw new Error('fetchImpl must not be invoked for a blocked URL');
    };

    for (const badUrl of ['http://127.0.0.1:9999/artifact', 'http://localhost:9999/artifact', 'http://192.168.1.5/artifact', 'ftp://example.invalid/artifact']) {
      const result = await resolveTrainerArtifact({ artifactHash: hash, remoteUrl: badUrl, fetchImpl, cacheDir });
      assert.equal(result.status, 'blocked-url', `expected ${badUrl} to be blocked`);
    }
    assert.equal(called, false);
  });

  test('allowPrivateNetworkHosts explicitly permits a loopback URL for local mock/dev use', async () => {
    const buffer = Buffer.from('allowed-private-host-fixture');
    const hash = computeArtifactHash(buffer);
    const { fetchImpl, calls } = makeFetchImplReturning(buffer);

    const result = await resolveTrainerArtifact({
      artifactHash: hash,
      remoteUrl: 'http://127.0.0.1:9999/artifact',
      fetchImpl,
      cacheDir,
      allowPrivateNetworkHosts: true,
    });

    assert.equal(result.status, 'fetched');
    assert.equal(calls.length, 1);
  });

  test('rejects a download whose real byte length exceeds the size cap, even if Content-Length under-reports it', async () => {
    const hash = computeArtifactHash(Buffer.from('oversized-fixture'));
    const oversized = Buffer.alloc(257 * 1024 * 1024, 1);
    const fetchImpl: TrainerArtifactFetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? '10' : null) },
      async arrayBuffer() {
        return oversized.buffer.slice(oversized.byteOffset, oversized.byteOffset + oversized.byteLength);
      },
    });

    const result = await resolveTrainerArtifact({ artifactHash: hash, remoteUrl: 'https://example.invalid/artifact', fetchImpl, cacheDir });

    assert.equal(result.status, 'too-large');
    assert.equal(getTrainerArtifact(hash), null, 'an oversized download must never be registered');
  });

  test('rejects a download whose declared Content-Length alone exceeds the cap, without reading the body', async () => {
    const hash = computeArtifactHash(Buffer.from('declared-oversized-fixture'));
    let bodyRead = false;
    const fetchImpl: TrainerArtifactFetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(300 * 1024 * 1024) : null) },
      async arrayBuffer() {
        bodyRead = true;
        return new ArrayBuffer(0);
      },
    });

    const result = await resolveTrainerArtifact({ artifactHash: hash, remoteUrl: 'https://example.invalid/artifact', fetchImpl, cacheDir });

    assert.equal(result.status, 'too-large');
    assert.equal(bodyRead, false, 'a declared oversized Content-Length should short-circuit before reading the body');
  });
});

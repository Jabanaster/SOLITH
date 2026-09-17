/**
 * Real, verified algorithm coverage for Phase 3's hash architecture
 * (ROADMAP.md §9 PHASE 3): xxHash64 fast pre-filter + BLAKE3 authoritative
 * content identity. Digests are checked against the algorithms' own published
 * test vectors, not just "it returns something" — a wrong-but-present hash
 * would be worse than no hash (false-positive identity).
 */
import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeFastHash,
  computeContentHash,
  resetContentHashCachesForTesting,
} from '../src/core/executable-identity/content-hash.ts';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-content-hash-'));
});

afterAll(() => {
  resetContentHashCachesForTesting();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('computeContentHash (BLAKE3)', () => {
  test('matches the published BLAKE3("") test vector', async () => {
    const filePath = writeFixture('empty.bin', '');
    const digest = await computeContentHash(filePath);
    assert.equal(digest, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  });

  test('matches the published BLAKE3("abc") test vector', async () => {
    const filePath = writeFixture('abc.bin', 'abc');
    const digest = await computeContentHash(filePath);
    assert.equal(digest, '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
  });

  test('different content produces a different digest', async () => {
    const a = await computeContentHash(writeFixture('a.bin', 'content-a'));
    const b = await computeContentHash(writeFixture('b.bin', 'content-b'));
    assert.notEqual(a, b);
  });

  test('identical content at different paths produces the identical digest (deterministic build identity)', async () => {
    const a = await computeContentHash(writeFixture('same-1.bin', 'identical-payload'));
    const b = await computeContentHash(writeFixture('same-2.bin', 'identical-payload'));
    assert.equal(a, b);
  });

  test('returns null for a missing file rather than throwing', async () => {
    const digest = await computeContentHash(path.join(tmpDir, 'does-not-exist.bin'));
    assert.equal(digest, null);
  });

  test('cache invalidates when file content and mtime change', async () => {
    const filePath = writeFixture('mutable.bin', 'version-1');
    const first = await computeContentHash(filePath);
    // Force a distinct mtime — some filesystems have 1s+ mtime resolution.
    const future = new Date(Date.now() + 5000);
    fs.writeFileSync(filePath, 'version-2-longer-payload');
    fs.utimesSync(filePath, future, future);
    const second = await computeContentHash(filePath);
    assert.notEqual(first, second);
  });
});

describe('computeFastHash (xxHash64)', () => {
  test('matches the published xxHash64("") test vector (seed 0)', async () => {
    const digest = await computeFastHash(writeFixture('xx-empty.bin', ''));
    assert.equal(digest, 'ef46db3751d8e999');
  });

  test('matches the published xxHash64("abc") test vector (seed 0)', async () => {
    const digest = await computeFastHash(writeFixture('xx-abc.bin', 'abc'));
    assert.equal(digest, '44bc2cf5ad770999');
  });

  test('is independent from and does not equal the BLAKE3 digest of the same content', async () => {
    const filePath = writeFixture('compare.bin', 'compare-me');
    const fast = await computeFastHash(filePath);
    const authoritative = await computeContentHash(filePath);
    assert.notEqual(fast, authoritative);
    assert.equal(fast?.length, 16); // 64-bit hex
    assert.equal(authoritative?.length, 64); // 256-bit hex
  });

  test('returns null for a missing file rather than throwing', async () => {
    const digest = await computeFastHash(path.join(tmpDir, 'does-not-exist-2.bin'));
    assert.equal(digest, null);
  });
});

describe('content hashing over a multi-chunk file (streaming correctness)', () => {
  test('BLAKE3 and xxHash64 of a file spanning multiple read chunks match whole-buffer computation', async () => {
    // Larger than the module's internal 1 MiB read-chunk size, so this
    // exercises the multi-chunk streaming path, not just a single read().
    const bigContent = Buffer.alloc(3 * 1024 * 1024 + 777, 0x5a);
    const filePath = path.join(tmpDir, 'big.bin');
    fs.writeFileSync(filePath, bigContent);

    const streamedContentHash = await computeContentHash(filePath);
    const streamedFastHash = await computeFastHash(filePath);

    const { createHash } = await import('blake3');
    const wholeBufferBlake3 = Buffer.from(createHash().update(bigContent).digest()).toString('hex');

    const xxhashModule = (await import('xxhash-wasm')).default;
    const xxhashApi = await xxhashModule();
    const wholeBufferXx = xxhashApi.h64Raw(bigContent).toString(16).padStart(16, '0');

    assert.equal(streamedContentHash, wholeBufferBlake3);
    assert.equal(streamedFastHash, wholeBufferXx);
  });
});

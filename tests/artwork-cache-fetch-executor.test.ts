import { describe, test, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchArtworkJob, type ArtworkFetchImpl } from '../src/core/artwork-cache/fetch-executor.ts';
import type { ArtworkFetchJob } from '../src/core/artwork-cache/types.ts';

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-artwork-fetch-test-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function job(overrides: Partial<ArtworkFetchJob> = {}): ArtworkFetchJob {
  return {
    catalogGameId: 'stardew-valley',
    kind: 'header',
    sourceUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg',
    priority: 'visible',
    // Persistable by default so the pre-existing download-pipeline tests below
    // keep exercising the full path; the rights-gate tests further down
    // override this explicitly.
    rightsClass: 'user-provided',
    ...overrides,
  };
}

function okResponse(body: string, contentType = 'image/jpeg'): ReturnType<ArtworkFetchImpl> extends Promise<infer T> ? T : never {
  const bytes = Buffer.from(body);
  return {
    status: 200,
    ok: true,
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return contentType;
        if (name === 'content-length') return String(bytes.byteLength);
        return null;
      },
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe('fetchArtworkJob', () => {
  test('rejects a URL not on the approved host allowlist without calling fetch', async () => {
    let called = false;
    const result = await fetchArtworkJob(job({ sourceUrl: 'https://evil.example.com/x.jpg' }), {
      cacheDir: makeTempDir(),
      fetchImpl: async () => {
        called = true;
        throw new Error('should never be called');
      },
    });
    assert.equal(result.status, 'failed');
    assert.equal(called, false);
  });

  test('writes a valid image response to disk and records an ok cache entry', async () => {
    const cacheDir = makeTempDir();
    const result = await fetchArtworkJob(job(), {
      cacheDir,
      fetchImpl: async () => okResponse('fake-image-bytes'),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.rightsClass, 'user-provided');
    assert.equal(result.sizeBytes, Buffer.byteLength('fake-image-bytes'));
    assert.ok(fs.existsSync(result.localPath));
    assert.equal(fs.readFileSync(result.localPath).toString(), 'fake-image-bytes');
  });

  test('rejects a disallowed content-type (e.g. SVG) without writing anything', async () => {
    const cacheDir = makeTempDir();
    const result = await fetchArtworkJob(job(), {
      cacheDir,
      fetchImpl: async () => okResponse('<svg/>', 'image/svg+xml'),
    });
    assert.equal(result.status, 'failed');
    assert.deepEqual(fs.readdirSync(cacheDir), []);
  });

  test('rejects a body larger than the size cap', async () => {
    const cacheDir = makeTempDir();
    const oversized = 'x'.repeat(9 * 1024 * 1024);
    const result = await fetchArtworkJob(job(), {
      cacheDir,
      fetchImpl: async () => okResponse(oversized),
    });
    assert.equal(result.status, 'failed');
    assert.match(result.lastError ?? '', /size cap/i);
  });

  test('follows an allowlisted redirect once, then succeeds', async () => {
    const cacheDir = makeTempDir();
    let calls = 0;
    const result = await fetchArtworkJob(job(), {
      cacheDir,
      fetchImpl: async (url) => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 302,
            ok: false,
            headers: { get: (name: string) => (name === 'location' ? 'https://cdn.akamai.steamstatic.com/steam/apps/413150/header.jpg' : null) },
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }
        return okResponse('redirected-image');
      },
    });
    assert.equal(result.status, 'ok');
    assert.equal(calls, 2);
  });

  test('rejects a redirect to a non-allowlisted host', async () => {
    const cacheDir = makeTempDir();
    const result = await fetchArtworkJob(job(), {
      cacheDir,
      fetchImpl: async () => ({
        status: 302,
        ok: false,
        headers: { get: (name: string) => (name === 'location' ? 'https://evil.example.com/steal.jpg' : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    assert.equal(result.status, 'failed');
  });

  test('gives up after exceeding the redirect cap', async () => {
    const cacheDir = makeTempDir();
    let calls = 0;
    const result = await fetchArtworkJob(job(), {
      cacheDir,
      fetchImpl: async () => {
        calls += 1;
        return {
          status: 302,
          ok: false,
          headers: { get: (name: string) => (name === 'location' ? 'https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg' : null) },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    });
    assert.equal(result.status, 'failed');
    assert.match(result.lastError ?? '', /redirect/i);
    assert.ok(calls <= 5, 'must not loop indefinitely');
  });

  test('records a failed entry for a non-2xx HTTP status', async () => {
    const result = await fetchArtworkJob(job(), {
      cacheDir: makeTempDir(),
      fetchImpl: async () => ({
        status: 404,
        ok: false,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    });
    assert.equal(result.status, 'failed');
    assert.match(result.lastError ?? '', /404/);
  });

  test('records a failed entry when the fetch implementation throws (network error)', async () => {
    const result = await fetchArtworkJob(job(), {
      cacheDir: makeTempDir(),
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    assert.equal(result.status, 'failed');
    assert.match(result.lastError ?? '', /ECONNRESET/);
  });

  // ROADMAP Mission 6 — timeout, corrupt-payload, and stale-cache-row
  // degrade-cleanly coverage. See tests/artwork-cache-fetch-policy.test.ts
  // and tests/artwork-cache-personal-game-priority-fill.test.ts for the
  // adjacent request-storm ("no repeated fetch loop") coverage.
  describe('failure degrades cleanly (never throws out of fetchArtworkJob, never writes a partial file)', () => {
    test('a timed-out request (fetchImpl rejects with AbortError, as a real fetch() does once its signal fires) records a failed entry, never a thrown exception', async () => {
      // fetchArtworkJob wires a real AbortController + 20s timeout
      // internally (FETCH_TIMEOUT_MS is not test-injectable, so this
      // exercises the same rejection shape a real fetch() implementation
      // produces once that internal signal fires, without waiting out the
      // real 20s timer) and passes the signal through to fetchImpl —
      // confirmed by asserting the signal argument is present and unaborted
      // at call time below.
      const cacheDir = makeTempDir();
      let sawSignal = false;
      const result = await fetchArtworkJob(job(), {
        cacheDir,
        fetchImpl: async (_url, init) => {
          sawSignal = init.signal instanceof AbortSignal && !init.signal.aborted;
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          throw error;
        },
      });
      assert.equal(sawSignal, true);
      assert.equal(result.status, 'failed');
      assert.match(result.lastError ?? '', /aborted/i);
      assert.deepEqual(fs.readdirSync(cacheDir), []);
    });

    test('a response with no body at all (0-length) is rejected as failed, not written as a 0-byte "ok" file', async () => {
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job(), {
        cacheDir,
        fetchImpl: async () => okResponse(''),
      });
      assert.equal(result.status, 'failed');
      assert.match(result.lastError ?? '', /empty/i);
      assert.deepEqual(fs.readdirSync(cacheDir), []);
    });

    test('KNOWN GAP (documented, not fixed by this pass): fetch-executor validates content-type and size, but never decodes/verifies the actual image bytes — a "corrupt image" (garbage bytes under an honest image/jpeg header) is written to disk as status "ok". Real-world degrade-to-fallback for this case happens at the RENDER layer, not here: GameCard.tsx / CatalogCard (TrainerLibraryPage.tsx) / DetailBanner.tsx all wire an <img onError> handler that swaps to the SOLITH branded fallback when the browser fails to decode the served file — verified by code inspection of each component\'s onError handler, not by this Node-only test (no DOM/image decoder available here).', async () => {
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job(), {
        cacheDir,
        fetchImpl: async () => okResponse('this-is-not-real-jpeg-bytes'),
      });
      assert.equal(result.status, 'ok');
      assert.ok(fs.existsSync(result.localPath));
    });
  });

  describe('persistent-cache rights gate', () => {
    test('remote-unverified-rights (e.g. Steam CDN) is rejected without ever calling fetch', async () => {
      let called = false;
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job({ rightsClass: 'remote-unverified-rights' }), {
        cacheDir,
        fetchImpl: async () => {
          called = true;
          throw new Error('should never be called — rights gate must short-circuit before any network fetch');
        },
      });
      assert.equal(result.status, 'rights-blocked');
      assert.equal(called, false);
      assert.deepEqual(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [], []);
    });

    test('a valid image with rightsClass=solith-owned is persisted', async () => {
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job({ rightsClass: 'solith-owned' }), {
        cacheDir,
        fetchImpl: async () => okResponse('owned-bytes'),
      });
      assert.equal(result.status, 'ok');
      assert.ok(fs.existsSync(result.localPath));
    });

    test('a valid image with rightsClass=explicitly-licensed is persisted', async () => {
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job({ rightsClass: 'explicitly-licensed' }), {
        cacheDir,
        fetchImpl: async () => okResponse('licensed-bytes'),
      });
      assert.equal(result.status, 'ok');
      assert.ok(fs.existsSync(result.localPath));
    });

    test('a valid image with rightsClass=user-provided is persisted', async () => {
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job({ rightsClass: 'user-provided' }), {
        cacheDir,
        fetchImpl: async () => okResponse('user-bytes'),
      });
      assert.equal(result.status, 'ok');
      assert.ok(fs.existsSync(result.localPath));
    });

    test('Steam CDN classification never automatically upgrades to a persistable rights class', async () => {
      // A successful, policy-passing download from an allowlisted host still
      // must not be persisted unless its rights class independently allows it —
      // fetchability and permission-to-persist are different axes.
      const cacheDir = makeTempDir();
      const result = await fetchArtworkJob(job({ rightsClass: 'remote-unverified-rights' }), {
        cacheDir,
        fetchImpl: async () => okResponse('steam-bytes'),
      });
      assert.equal(result.status, 'rights-blocked');
      assert.equal(result.localPath, '');
    });
  });
});

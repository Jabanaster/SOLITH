/**
 * Real Workers runtime + real local D1 tests (via @cloudflare/vitest-pool-workers
 * + miniflare — see vitest.config.ts and test/apply-migrations.ts). These
 * run INSIDE workerd, against a real local D1 database seeded by
 * migrations/0001_init_schema.sql and 0002_seed_fixtures.sql — no FakeD1.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const SEEDED_ARTIFACT_HASH = '6c8fed01e93f1e1197a87d61bd2d8ea3223ee595a01aeee8e488dae19d1c1fd3';

describe('GET /health', () => {
  it('reports healthy after a real D1 round-trip', async () => {
    const response = await app.request('/health', undefined, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { status: string; database: string; scope: string };
    expect(body).toMatchObject({ status: 'healthy', database: 'connected', scope: 'read-only' });
  });
});

describe('GET /catalog/sync', () => {
  it('returns the full seeded fixture set on an initial sync (no since)', async () => {
    const response = await app.request('/catalog/sync', undefined, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as {
      catalogRevision: string;
      trainerRevision: string;
      changedCatalogEntries: Array<{ solithGameId: string; trainerAvailable: boolean; aliases: string[] }>;
      changedTrainerCoverage: Array<{ gameId: string; trainerAvailable: boolean }>;
      deletedSolithGameIds: string[];
    };

    expect(body.catalogRevision).toBe('3');
    expect(body.trainerRevision).toBe('3');
    expect(body.changedCatalogEntries).toHaveLength(3);
    expect(body.changedTrainerCoverage).toHaveLength(3);
    expect(body.deletedSolithGameIds).toEqual([]);

    const atomfall = body.changedCatalogEntries.find((entry) => entry.solithGameId === 'atomfall');
    expect(atomfall).toMatchObject({ trainerAvailable: true });
    expect(Array.isArray(atomfall?.aliases)).toBe(true);

    const atomfallCoverage = body.changedTrainerCoverage.find((row) => row.gameId === 'atomfall');
    expect(atomfallCoverage).toMatchObject({ trainerAvailable: true });
  });

  it('returns only rows newer than the requested revision (delta sync)', async () => {
    const response = await app.request('/catalog/sync?since=2', undefined, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { changedCatalogEntries: Array<{ solithGameId: string }> };
    expect(body.changedCatalogEntries.map((e) => e.solithGameId)).toEqual(['hogwarts-legacy']);
  });

  it('returns an empty (noop-shaped) delta when since is already current', async () => {
    const response = await app.request('/catalog/sync?since=3', undefined, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      catalogRevision: string;
      changedCatalogEntries: unknown[];
      changedTrainerCoverage: unknown[];
      deletedSolithGameIds: unknown[];
    };
    expect(body.catalogRevision).toBe('3');
    expect(body.changedCatalogEntries).toEqual([]);
    expect(body.changedTrainerCoverage).toEqual([]);
    expect(body.deletedSolithGameIds).toEqual([]);
  });

  it('rejects a malformed since value with 400, never 500', async () => {
    const response = await app.request('/catalog/sync?since=not-a-number', undefined, env);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_query');
  });

  it('rejects a negative/padded/oversized/empty since value with 400', async () => {
    for (const bad of ['-1', '007', '1'.repeat(40), '1.5', '']) {
      const response = await app.request(`/catalog/sync?since=${encodeURIComponent(bad)}`, undefined, env);
      expect(response.status, `since=${JSON.stringify(bad)} should be rejected`).toBe(400);
    }
  });
});

describe('GET /artifacts/:hash', () => {
  it('serves the seeded artifact bytes with immutable cache headers and verifies its own hash', async () => {
    const response = await app.request(`/artifacts/${SEEDED_ARTIFACT_HASH}`, undefined, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(51);

    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actualHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(actualHash).toBe(SEEDED_ARTIFACT_HASH);
  });

  it('returns 404 (deterministic JSON, not a stack trace) for a well-formed but unknown hash', async () => {
    const unknownHash = 'f'.repeat(64);
    const response = await app.request(`/artifacts/${unknownHash}`, undefined, env);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body).toEqual({ error: 'artifact_not_found' });
  });

  it('rejects a malformed hash BEFORE any storage lookup, for every unsafe-shape input', async () => {
    const malformed = [
      'not-a-hash',
      'a'.repeat(63),
      'a'.repeat(65),
      `${'a'.repeat(64)}/../../etc/passwd`,
      `${'A'.repeat(64)}`, // uppercase not allowed — canonical form is lowercase only
      '../../../etc/passwd',
      `${SEEDED_ARTIFACT_HASH}%00`,
    ];
    for (const hash of malformed) {
      const response = await app.request(`/artifacts/${encodeURIComponent(hash)}`, undefined, env);
      expect(response.status, `hash=${JSON.stringify(hash)} should be rejected as 400`).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body).toEqual({ error: 'invalid_artifact_hash' });
    }
  });
});

describe('unmatched routes and errors', () => {
  it('returns a deterministic JSON 404 for an unknown route', async () => {
    const response = await app.request('/nope', undefined, env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('never exposes a write endpoint of any kind (read-only scope boundary)', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.request('/catalog/sync', { method }, env);
      expect(response.status, `${method} /catalog/sync must not be a write endpoint`).not.toBe(200);
      const response2 = await app.request('/artifacts/' + SEEDED_ARTIFACT_HASH, { method }, env);
      expect(response2.status, `${method} /artifacts/:hash must not be a write endpoint`).not.toBe(200);
    }
  });
});

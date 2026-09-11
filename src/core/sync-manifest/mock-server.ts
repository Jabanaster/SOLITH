/**
 * ROADMAP §online-foundation Mission 20 — server abstraction proof.
 *
 * ============================================================================
 * THIS IS A LOCAL DEVELOPMENT FIXTURE. IT IS NOT A REAL BACKEND.
 * ============================================================================
 *
 * `MockSyncServer` is an in-memory stand-in for whatever real HTTP backend
 * eventually serves SOLITH's discovery-catalog sync, trainer-artifact
 * download, and community-submission endpoints (today that role is played
 * by the real Cloudflare Worker referenced in
 * src/core/trainer-catalog/sync/hub-client.ts's SOLITH_HUB_BASE_URL, for a
 * *different* sync surface). It exists to PROVE an architectural property,
 * not to ship as product code:
 *
 *   `fetchSyncManifest` (src/core/sync-manifest/client.ts) and
 *   `resolveTrainerArtifact` (src/core/trainer-artifact-cache/cache.ts) both
 *   accept their network dependency as an injected `fetchImpl` function.
 *   Neither module imports, constructs, or references any concrete HTTP
 *   client, hostname, or transport. `MockSyncServer.fetchImpl` below is a
 *   plain function matching the exact same minimal Response-like shape
 *   (`{ ok, status, json(), text(), arrayBuffer() }`) that a real
 *   `fetch()` call satisfies.
 *
 *   Consequence: swapping this mock for a real HTTP client later (e.g.
 *   `fetchImpl: (url, init) => fetch(url, init)` against a real backend)
 *   requires editing ONLY the call site that constructs the `fetchImpl`
 *   argument — zero changes to `fetchSyncManifest`, `applySyncManifestDelta`,
 *   or `resolveTrainerArtifact` themselves. tests/local-e2e-sync-proof.test.ts
 *   exercises this end-to-end using nothing but this mock and the real local
 *   modules, with no real network access anywhere in the test.
 *
 * Holds three in-memory stores (catalog, artifact blobs, community
 * submissions) plus test-only mutators (`_seedCatalogEntry`, `_seedArtifact`,
 * `_goOffline`/`_goOnline`) for driving scenarios deterministically.
 */

import type { DiscoveryCatalogEntry } from '../discovery-catalog/types.js';

/** Minimal Response-like shape — matches what a real `fetch()` Response satisfies structurally. */
export interface MockFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Same signature shape consumed by both SyncManifestFetchImpl and TrainerArtifactFetchImpl (structural superset). */
export type MockFetchImpl = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<MockFetchResponse>;

export interface MockCommunitySubmissionRecord {
  submissionId: string;
  artifactHash: string;
  trainerId: string;
  submittedAt: string;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function jsonResponse(status: number, data: unknown): MockFetchResponse {
  const text = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(text) as unknown;
    },
    async text() {
      return text;
    },
    async arrayBuffer() {
      return toArrayBuffer(Buffer.from(text, 'utf-8'));
    },
  };
}

function binaryResponse(status: number, buffer: Buffer): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new Error('mock server: binary response is not JSON');
    },
    async text() {
      return buffer.toString('utf-8');
    },
    async arrayBuffer() {
      return toArrayBuffer(buffer);
    },
  };
}

interface CatalogSlot {
  entry: DiscoveryCatalogEntry;
  revision: number;
}

/** LOCAL DEVELOPMENT FIXTURE — see file header. Not a real backend. */
export class MockSyncServer {
  readonly baseUrl = 'https://mock-solith-hub.local';

  private catalog = new Map<string, CatalogSlot>();
  private artifacts = new Map<string, Buffer>();
  private submissions: MockCommunitySubmissionRecord[] = [];
  private revisionCounter = 0;
  private online = true;
  private callCount = 0;
  private forcedNextSyncRevision: {
    catalogRevision?: unknown;
    trainerRevision?: unknown;
    omitRevision?: boolean;
  } | null = null;

  /** Real endpoint URL a caller passes as `fetchSyncManifest`'s `endpointUrl`. */
  get syncEndpointUrl(): string {
    return `${this.baseUrl}/sync`;
  }

  /** Real endpoint URL a caller uses as `resolveTrainerArtifact`'s `remoteUrl` for a given hash. */
  artifactDownloadUrl(artifactHash: string): string {
    return `${this.baseUrl}/artifact?hash=${encodeURIComponent(artifactHash)}`;
  }

  /** Number of times `fetchImpl` has actually been invoked — used to prove "zero additional network calls" while offline/cached. */
  get networkCallCount(): number {
    return this.callCount;
  }

  // ---- test-only mutators -------------------------------------------------

  _seedCatalogEntry(entry: DiscoveryCatalogEntry): void {
    this.revisionCounter += 1;
    this.catalog.set(entry.solithGameId, { entry, revision: this.revisionCounter });
  }

  _seedArtifact(artifactHash: string, buffer: Buffer): void {
    this.artifacts.set(artifactHash, buffer);
  }

  _recordSubmission(record: MockCommunitySubmissionRecord): void {
    this.submissions.push(record);
  }

  _listSubmissions(): readonly MockCommunitySubmissionRecord[] {
    return this.submissions;
  }

  _goOffline(): void {
    this.online = false;
  }

  _goOnline(): void {
    this.online = true;
  }

  /**
   * Phase 1.5 Mission A1 (security closeout) test hook: forces the NEXT
   * `/sync` response's revision fields to whatever `override` says instead
   * of the server's real (correctly-ordered) counter — a stale value, a
   * malformed string, or omitted entirely (`omitRevision: true`). One-shot:
   * cleared as soon as one `/sync` response is served, so the mock reverts
   * to normal well-behaved output afterward. This exists purely so
   * adversarial client-side tests can exercise `applySyncManifestDelta`'s
   * anti-rollback defenses against a misbehaving/compromised server without
   * the mock's own bookkeeping ever producing a stale revision on its own.
   */
  _forceNextSyncRevision(override: { catalogRevision?: unknown; trainerRevision?: unknown; omitRevision?: boolean }): void {
    this.forcedNextSyncRevision = override;
  }

  // ---- "real" endpoints, served over the injected fetchImpl ---------------

  /**
   * Drop-in `fetchImpl` for BOTH `fetchSyncManifest` and
   * `resolveTrainerArtifact` — bound so it can be handed around as a plain
   * function reference (`const fetchImpl = server.fetchImpl`).
   */
  fetchImpl: MockFetchImpl = async (url) => {
    this.callCount += 1;
    if (!this.online) {
      throw new Error('mock server is offline (simulated network unreachable)');
    }

    const parsed = new URL(url);
    if (parsed.pathname === '/sync') {
      return this.handleSync(parsed);
    }
    if (parsed.pathname === '/artifact') {
      return this.handleArtifactDownload(parsed);
    }
    return jsonResponse(404, { error: `mock server: no route for ${parsed.pathname}` });
  };

  private handleSync(url: URL): MockFetchResponse {
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw ? Number(sinceRaw) : 0;
    const sinceRevision = Number.isFinite(since) ? since : 0;

    const changedCatalogEntries = [...this.catalog.values()]
      .filter((slot) => slot.revision > sinceRevision)
      .map((slot) => slot.entry);

    const body: Record<string, unknown> = {
      catalogRevision: String(this.revisionCounter),
      trainerRevision: String(this.revisionCounter),
      changedCatalogEntries,
      changedTrainerCoverage: [],
      deletedSolithGameIds: [],
    };

    if (this.forcedNextSyncRevision) {
      const override = this.forcedNextSyncRevision;
      this.forcedNextSyncRevision = null; // one-shot
      if (override.omitRevision) {
        delete body.catalogRevision;
        delete body.trainerRevision;
      } else {
        if ('catalogRevision' in override) body.catalogRevision = override.catalogRevision;
        if ('trainerRevision' in override) body.trainerRevision = override.trainerRevision;
      }
    }

    return jsonResponse(200, body);
  }

  private handleArtifactDownload(url: URL): MockFetchResponse {
    const hash = url.searchParams.get('hash');
    const buffer = hash ? this.artifacts.get(hash) : undefined;
    if (!buffer) {
      return jsonResponse(404, { error: 'artifact not found' });
    }
    return binaryResponse(200, buffer);
  }
}

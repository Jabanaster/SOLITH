/**
 * ROADMAP §online-foundation Phase 2 Part B — real HTTP fetchImpl for
 * `fetchSyncManifest` (src/core/sync-manifest/client.ts).
 *
 * Vendor-abstraction proof: `SyncManifestFetchImpl` is
 * `(url, init) => Promise<{ ok, status, text() }>` — a real `fetch()` call
 * satisfies that shape STRUCTURALLY with zero adaptation. This module is
 * therefore not a shim or adapter, just a typed alias binding
 * `globalThis.fetch` to the interface `client.ts` already expects — proof
 * that the "same logical client flow runs against MockSyncServer OR a real
 * backend by swapping only fetchImpl" claim holds with ZERO changes to
 * client.ts, applySyncManifestDelta, or any other Mission 10 module.
 *
 * Deliberately does not add retries, extra headers, or any other behavior
 * beyond what `fetch` already does — client.ts already owns timeout
 * (AbortSignal.timeout-equivalent via its own controller), response-size
 * capping, and JSON-shape validation. Adding logic here would duplicate
 * that, not extend it.
 */
import type { SyncManifestFetchImpl } from './client.js';

/** Real network fetchImpl — hand this to `fetchSyncManifest({ ..., fetchImpl: realSyncManifestFetchImpl })` to hit an actual HTTP backend instead of `MockSyncServer.fetchImpl`. */
export const realSyncManifestFetchImpl: SyncManifestFetchImpl = (url, init) => globalThis.fetch(url, init);

/**
 * ROADMAP §online-foundation Phase 2 Part B — real HTTP fetchImpl for
 * `resolveTrainerArtifact` (src/core/trainer-artifact-cache/cache.ts).
 *
 * Vendor-abstraction proof: `TrainerArtifactFetchImpl` is
 * `(url, init) => Promise<{ ok, status, headers?, arrayBuffer() }>` — a real
 * `fetch()` call satisfies that shape STRUCTURALLY with zero adaptation.
 * This module is therefore not a shim, just a typed alias binding
 * `globalThis.fetch` to the interface `cache.ts` already expects.
 *
 * Same conclusion as src/core/sync-manifest/http-fetch-impl.ts: the
 * fetchImpl substitution genuinely requires ZERO client-code changes — no
 * response-shape mismatch was found. cache.ts already owns its own
 * timeout, SSRF host-allowlist check, byte-cap enforcement, and SHA-256
 * verification; this module intentionally adds nothing beyond the raw
 * fetch call.
 */
import type { TrainerArtifactFetchImpl } from './types.js';

/** Real network fetchImpl — hand this to `resolveTrainerArtifact({ ..., fetchImpl: realTrainerArtifactFetchImpl })` to fetch from an actual HTTP backend instead of `MockSyncServer.fetchImpl`. */
export const realTrainerArtifactFetchImpl: TrainerArtifactFetchImpl = (url, init) => globalThis.fetch(url, init);

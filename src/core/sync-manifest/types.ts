/**
 * ROADMAP §online-foundation Mission 10 — sync manifest model.
 *
 * A "sync manifest delta" is the shape a remote sync service (real hub
 * backend today's Cloudflare Worker precedent, or the Mission 20 in-memory
 * mock) returns to describe what changed since a given local revision
 * cursor. Deliberately small and JSON-shaped so it can travel over an
 * ordinary fetch() response body.
 */

import type { DiscoveryCatalogEntry } from '../discovery-catalog/types.js';

/**
 * A sync revision cursor: a canonical non-negative base-10 integer encoded
 * as a JSON string — e.g. `"0"`, `"1"`, `"42"`. No sign, no leading zeros
 * (other than the literal `"0"`), no decimal point or exponent.
 *
 * Phase 1.5 Mission A1 (security closeout) decision: this format is kept
 * as-is rather than replaced (mock-server.ts already produces exactly this
 * shape via `String(revisionCounter)`), because the underlying value is
 * genuinely a monotonically-increasing integer counter — it just travels as
 * text so it fits an ordinary JSON manifest body. What was missing was not
 * the representation but the ordering rule: an unpadded decimal string is
 * NOT safe to compare lexically (`"9" > "10"` as strings, which is wrong),
 * so ordering MUST always go through `compareSyncRevisions` in
 * `sync-manifest/revision.ts`, which parses both sides as integers (via
 * BigInt) and fails closed — verdict `'invalid'` — on anything that doesn't
 * match this exact grammar. Never compare two `SyncRevision` values with
 * `<`, `>`, or `===` directly.
 */
export type SyncRevision = string;

/**
 * `changedTrainerCoverage` is intentionally `unknown[]` — trainer coverage
 * sync is a separate, not-yet-modeled Mission; this contract reserves the
 * field so a manifest producer can start populating it without a breaking
 * type change later, while callers today only ever iterate/ignore it.
 */
export interface SyncManifestDelta {
  catalogRevision: SyncRevision;
  trainerRevision: SyncRevision;
  changedCatalogEntries: DiscoveryCatalogEntry[];
  changedTrainerCoverage: unknown[];
  deletedSolithGameIds: string[];
}

/** Persisted per-service sync cursor — mirrors the `sync_manifest_state` table 1:1. */
export interface SyncManifestState {
  service: string;
  catalogRevision: SyncRevision | null;
  trainerRevision: SyncRevision | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
}

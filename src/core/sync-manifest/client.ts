/**
 * ROADMAP §online-foundation Mission 10 — sync manifest client.
 *
 * Mirrors src/core/trainer-catalog/sync/hub-client.ts's defensive style
 * (injected fetchImpl, AbortSignal.timeout, size-capped body reads, strict
 * JSON parsing) with one deliberate difference: hub-client.ts's
 * syncCommunityDefinitions THROWS on a sync failure. This module never
 * throws — every failure mode (network error, bad JSON, oversized body,
 * non-2xx status) comes back as a typed `{ error: string }` result instead,
 * per the owner's Mission 10 spec ("never throws"). Backend vendor stays
 * abstracted behind `fetchImpl`: this module never imports or references any
 * concrete HTTP client, only the injected function.
 */

import { upsertDiscoveryCatalogEntry } from '../discovery-catalog/store.js';
import type { SyncManifestDelta } from './types.js';
import { getSyncManifestState, recordSyncManifestState } from './store.js';
import { combineSyncRevisionVerdicts, compareSyncRevisions } from './revision.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * Minimal Response-like shape this client needs. Deliberately narrower than
 * `typeof fetch` so a real fetch() call, the Mission 20 mock server, or a
 * hand-rolled test stub can all satisfy it without a full Fetch API
 * polyfill.
 */
export type SyncManifestFetchImpl = (
  url: string,
  init: { signal: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface FetchSyncManifestInput {
  /** Logical remote service name — matches the `sync_manifest_state.service` row this sync tracks. */
  service: string;
  /** Base URL of the sync endpoint (e.g. a mock server's or real hub's `/sync` route). */
  endpointUrl: string;
  /** Revision cursor to request a delta since. Omit/empty for an initial full sync. */
  sinceRevision?: string;
  fetchImpl: SyncManifestFetchImpl;
}

export type FetchSyncManifestResult = SyncManifestDelta | { error: string };

function isSyncManifestDeltaShape(value: unknown): value is SyncManifestDelta {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.catalogRevision === 'string' &&
    typeof record.trainerRevision === 'string' &&
    Array.isArray(record.changedCatalogEntries) &&
    Array.isArray(record.changedTrainerCoverage) &&
    Array.isArray(record.deletedSolithGameIds)
  );
}

/**
 * Fetches a sync manifest delta from a remote (or mock) sync endpoint.
 * Never throws: every failure mode is a typed `{ error }` result so a caller
 * can safely no-op / retry-later without try/catch ceremony, matching the
 * artwork-cache fetch-executor.ts "never throws" precedent.
 */
export async function fetchSyncManifest(input: FetchSyncManifestInput): Promise<FetchSyncManifestResult> {
  const url = new URL(input.endpointUrl);
  url.searchParams.set('service', input.service);
  if (input.sinceRevision) {
    url.searchParams.set('since', input.sinceRevision);
  }

  let response: Awaited<ReturnType<SyncManifestFetchImpl>>;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await input.fetchImpl(url.toString(), {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    return { error: `sync manifest fetch failed with HTTP ${response.status}` };
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  if (new TextEncoder().encode(rawText).byteLength > MAX_RESPONSE_BYTES) {
    return { error: 'sync manifest response exceeded the size limit' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return { error: 'sync manifest response was not valid JSON' };
  }

  if (!isSyncManifestDeltaShape(parsed)) {
    return { error: 'sync manifest response did not match the expected delta shape' };
  }

  return parsed;
}

/**
 * `upsertedCatalogEntries` is present (as `0`) on every branch so existing
 * callers that only read that field (without branching on `status`) keep
 * working unchanged.
 */
export type ApplySyncManifestDeltaResult =
  | { status: 'applied'; upsertedCatalogEntries: number }
  | { status: 'noop'; upsertedCatalogEntries: 0 }
  | { status: 'rejected'; reason: string; upsertedCatalogEntries: 0 };

/**
 * Applies a fetched delta to local state: upserts every changed catalog
 * entry and records the new revision cursor. An empty delta (no-change
 * sync) is a real no-op in the data sense — zero upserts — but still
 * advances/records the revision cursor so the next sync's `sinceRevision`
 * reflects reality, PROVIDED the incoming revision is actually newer (see
 * below).
 *
 * SECURITY (Phase 1.5 Mission A1): before touching anything, the incoming
 * `catalogRevision`/`trainerRevision` are compared against the locally
 * stored cursor via `compareSyncRevisions` (src/core/sync-manifest/revision.ts):
 *
 *   - older or malformed/invalid on either side → the WHOLE delta is
 *     rejected: no catalog upserts, no `sync_manifest_state` write. This is
 *     the fix for the hostile-review finding that a compromised/malicious
 *     sync server could roll the client's cursor backward by replaying an
 *     old (or garbage) revision, which this function used to accept
 *     unconditionally.
 *   - exactly equal on both sides → idempotent no-op success: this is a
 *     normal retry of an already-applied sync, not an attack, so it must
 *     NOT be treated as a rejection. Zero upserts happen (so a server
 *     retry never double-applies `changedCatalogEntries`) and the stored
 *     cursor/timestamp are left untouched.
 *   - newer (on at least one field, with neither field older) → applied
 *     normally, exactly as before this fix.
 *
 * Deletions (`deletedSolithGameIds`) are recorded on the delta contract but
 * intentionally NOT applied here: discovery-catalog/store.ts exposes no
 * delete/prune operation today (upsert-only, matching the existing
 * "install-discovery is upsert-only" precedent in personal-library/model.ts).
 * Wiring an actual local delete is out of scope for Mission 10's data model
 * and would require a new store function this task was not asked to add.
 */
export function applySyncManifestDelta(service: string, delta: SyncManifestDelta): ApplySyncManifestDeltaResult {
  const stored = getSyncManifestState(service);
  const storedCatalogRevision = stored?.catalogRevision ?? null;
  const storedTrainerRevision = stored?.trainerRevision ?? null;

  const catalogVerdict = compareSyncRevisions(storedCatalogRevision, delta.catalogRevision);
  const trainerVerdict = compareSyncRevisions(storedTrainerRevision, delta.trainerRevision);
  const verdict = combineSyncRevisionVerdicts(catalogVerdict, trainerVerdict);

  if (verdict === 'invalid') {
    return {
      status: 'rejected',
      reason: 'sync manifest delta carried a malformed or unparseable revision cursor',
      upsertedCatalogEntries: 0,
    };
  }

  if (verdict === 'older') {
    return {
      status: 'rejected',
      reason: 'sync manifest delta revision is older than the locally stored cursor — rejected to prevent rollback',
      upsertedCatalogEntries: 0,
    };
  }

  if (verdict === 'equal') {
    // Idempotent retry of the current revision: a real no-op, not an
    // attack. Apply zero data changes and leave the stored cursor alone.
    return { status: 'noop', upsertedCatalogEntries: 0 };
  }

  for (const entry of delta.changedCatalogEntries) {
    upsertDiscoveryCatalogEntry(entry);
  }

  recordSyncManifestState(service, {
    catalogRevision: delta.catalogRevision,
    trainerRevision: delta.trainerRevision,
    lastSyncStatus: 'ok',
  });

  return { status: 'applied', upsertedCatalogEntries: delta.changedCatalogEntries.length };
}

/** Convenience accessor mirroring the store's shape, re-exported for callers that only need the cursor. */
export function currentSyncRevision(service: string): string | null {
  return getSyncManifestState(service)?.catalogRevision ?? null;
}

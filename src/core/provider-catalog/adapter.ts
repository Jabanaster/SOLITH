/**
 * SOLITH Phase 3 — provider-neutral catalog adapter contract (Mission 2).
 *
 * Every provider adapter (Steam, Epic, GOG, and future providers) implements
 * this SAME shape. No Steam-specific (or any-provider-specific) assumption
 * belongs in this file — provider-specific request/response shapes live
 * entirely inside each adapter's own module (steam-adapter.ts, etc.) and are
 * normalized to ProviderGameRecord before ever leaving that module.
 *
 * Network access is always injected (fetchImpl), never imported/constructed
 * inside an adapter — this is the same pattern established in
 * sync-manifest/client.ts and trainer-artifact-cache/cache.ts, and it is
 * what makes every adapter here testable with zero real network access.
 */
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { ProviderGameRecord } from './types.js';

/** Minimal Response-like shape a real `fetch()` satisfies — same contract as sync-manifest's MockFetchResponse. */
export interface AdapterFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type AdapterFetchImpl = (url: string, init?: { headers?: Record<string, string> }) => Promise<AdapterFetchResponse>;

/**
 * Hard safety ceiling on any single provider response body this codebase
 * will attempt to parse as JSON — mirrors trainer-artifact-cache's
 * MAX_TRAINER_ARTIFACT_BYTES precedent (Phase 1.5 P1 fix). A provider
 * response claiming to be larger than this is rejected before parsing,
 * never streamed into memory unbounded (Phase 3 Mission 33: "huge payload").
 */
export const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024 * 1024;

/** Hard ceiling on how many normalized records a single sync page/batch may report — guards against pagination abuse (Mission 33). */
export const MAX_RECORDS_PER_SYNC_PAGE = 100_000;

export type ProviderSyncStatus = 'ok' | 'no-change' | 'partial' | 'error';

export interface ProviderSyncResult {
  status: ProviderSyncStatus;
  records: ProviderGameRecord[];
  /** Opaque cursor/token to resume the NEXT sync from — persisted by the caller, never interpreted here. */
  nextCursor?: string;
  /** True when this adapter has no more pages to fetch this run. */
  complete: boolean;
  /** Present when status is 'error' or 'partial' — never thrown, always returned. */
  error?: string;
  /** Real record counts actually seen this call, for observability/reporting — never estimated. */
  fetchedCount: number;
  skippedUnchangedCount: number;
}

export interface ProviderCatalogSyncOptions {
  fetchImpl: AdapterFetchImpl;
  /** Resume cursor from a previous sync call, or undefined for a fresh/initial sync. */
  cursor?: string;
  /** Provider-specific API key/credential, when the provider requires one server-side. Never logged. */
  apiKey?: string;
  /** Looks up the last-known rawRevision for a (provider, providerGameId) so unchanged rows can be skipped. */
  getKnownRevision: (providerGameId: string) => string | null;
}

export interface ProviderCatalogAdapter {
  provider: LinkedLibraryProvider;
  /** One bounded page of catalog sync — callers loop until `complete: true`, never assumes a single call fetches everything. */
  syncPage(options: ProviderCatalogSyncOptions): Promise<ProviderSyncResult>;
}

/**
 * Fails closed on any response that isn't a genuinely small-enough,
 * well-formed JSON body. Never throws — every caller gets a typed result.
 */
export async function safeParseJsonResponse(
  response: AdapterFetchResponse,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  if (!response.ok) {
    return { ok: false, error: `upstream returned HTTP ${response.status}` };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { ok: false, error: `failed to read response body: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (text.length > MAX_PROVIDER_RESPONSE_BYTES) {
    return { ok: false, error: `response body exceeds ${MAX_PROVIDER_RESPONSE_BYTES} byte cap (${text.length} bytes)` };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'response body is not valid JSON' };
  }
}

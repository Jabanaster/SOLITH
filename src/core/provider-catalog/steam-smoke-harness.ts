/**
 * SOLITH Phase 3.1, Mission 13 — Steam real-smoke harness.
 *
 * Reads the Steam Web API key ONLY from the `SOLITH_STEAM_API_KEY`
 * environment variable — never from a file, never from a hardcoded
 * constant, never persisted anywhere. If absent, real network smoke is
 * skipped and reported as `LIVE_SMOKE_BLOCKED_NO_KEY` rather than treated
 * as a failure — per the owner's explicit instruction never to ask for a
 * key in chat.
 *
 * SECURITY (Mission 10): this module never logs, returns, or otherwise
 * exposes the key value itself in any of its return types — only a boolean
 * "key present" signal and, on a live attempt, the adapter's own typed
 * result (which is independently proven never to embed the key — see
 * tests/steam-catalog-adapter.test.ts's "API key never appears in the
 * returned error string" test).
 */
import { steamSyncPage } from './steam-adapter.js';
import type { AdapterFetchImpl } from './adapter.js';
import type { ProviderSyncResult } from './adapter.js';

export type SteamSmokeOutcome =
  | { status: 'LIVE_SMOKE_BLOCKED_NO_KEY' }
  | { status: 'LIVE_SMOKE_RAN'; result: ProviderSyncResult };

/**
 * Returns whether a Steam Web API key is configured, WITHOUT ever returning
 * the key value itself.
 */
export function hasSteamApiKey(): boolean {
  const key = process.env.SOLITH_STEAM_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

/**
 * Performs a bounded, read-only Steam catalog smoke call ONLY if
 * SOLITH_STEAM_API_KEY is set in the environment. `fetchImpl` is still
 * caller-injected (same pattern as every other adapter call site) — this
 * harness does not itself decide to use the real `fetch`; the caller (a
 * real-smoke test explicitly opting in) supplies it.
 */
export async function runBoundedSteamSmoke(fetchImpl: AdapterFetchImpl, maxResultsPerPage = 50): Promise<SteamSmokeOutcome> {
  const apiKey = process.env.SOLITH_STEAM_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return { status: 'LIVE_SMOKE_BLOCKED_NO_KEY' };
  }

  const result = await steamSyncPage({ apiKey, fetchImpl, getKnownRevision: () => null, maxResultsPerPage });
  return { status: 'LIVE_SMOKE_RAN', result };
}

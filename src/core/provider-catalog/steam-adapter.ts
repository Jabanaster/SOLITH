/**
 * SOLITH Phase 3, Mission 3/4/5 — Steam catalog ingestion.
 *
 * Uses the MODERN Steamworks endpoint `IStoreService/GetAppList` (v1), NOT
 * the deprecated `ISteamApps/GetAppList`. Documented at
 * https://partner.steamgames.com/doc/webapi/IStoreService#GetAppList
 * Requires a Steam Web API key (`apiKey`) — this module never fetches or
 * embeds one; the caller (backend/service layer) supplies it, and it is
 * never logged (see steamSyncPage's error paths — the key is never
 * interpolated into any returned/thrown string).
 *
 * Real endpoint: GET https://api.steampowered.com/IStoreService/GetAppList/v1/
 *   ?key=<key>&include_games=true&include_dlc=false&include_software=false
 *   &include_videos=false&include_hardware=false&max_results=<n>&last_appid=<cursor>
 *
 * Pagination: the response's `have_more_results`/`last_appid` fields form a
 * cursor — this adapter's `nextCursor` is exactly Steam's `last_appid`
 * stringified. No `if_modified_since` support is confirmed for this specific
 * endpoint (unverified in current research), so incremental sync here relies
 * on rawRevision (Steam's `last_modified` per-app) diffing at the caller
 * layer, not a server-side delta query — see Mission 5 test coverage.
 *
 * Renderer/client code must NEVER call this directly — it is designed to run
 * server/backend-side only, per the owner's explicit instruction to keep the
 * API key off the desktop client.
 */
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { ProviderGameRecord } from './types.js';
import {
  MAX_RECORDS_PER_SYNC_PAGE,
  safeParseJsonResponse,
  type ProviderCatalogSyncOptions,
  type ProviderSyncResult,
} from './adapter.js';
import { normalizeCatalogTitle } from '../trainer-catalog/normalize-title.js';

export const STEAM_PROVIDER: LinkedLibraryProvider = 'steam';
export const STEAM_STORE_SERVICE_BASE = 'https://api.steampowered.com/IStoreService/GetAppList/v1/';

interface SteamAppListEntry {
  appid?: unknown;
  name?: unknown;
  last_modified?: unknown;
}

interface SteamAppListResponseBody {
  response?: {
    apps?: unknown;
    have_more_results?: unknown;
    last_appid?: unknown;
  };
}

export interface SteamSyncOptions extends ProviderCatalogSyncOptions {
  /** Real Steam Web API key. Required — this adapter fails closed without one, never falls back to an unauthenticated call. */
  apiKey: string;
  /** Defaults to games-only (Mission 4). Set explicitly to include other types — never default-includes DLC/software/videos/hardware. */
  includeDlc?: boolean;
  includeSoftware?: boolean;
  includeVideos?: boolean;
  includeHardware?: boolean;
  maxResultsPerPage?: number;
}

function buildSteamAppListUrl(options: SteamSyncOptions): string {
  const params = new URLSearchParams({
    key: options.apiKey,
    include_games: 'true',
    include_dlc: String(Boolean(options.includeDlc)),
    include_software: String(Boolean(options.includeSoftware)),
    include_videos: String(Boolean(options.includeVideos)),
    include_hardware: String(Boolean(options.includeHardware)),
    max_results: String(Math.min(options.maxResultsPerPage ?? 10_000, MAX_RECORDS_PER_SYNC_PAGE)),
  });
  if (options.cursor) params.set('last_appid', options.cursor);
  return `${STEAM_STORE_SERVICE_BASE}?${params.toString()}`;
}

function isValidSteamAppId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 100_000_000;
}

/**
 * Normalizes one raw Steam app-list entry. Returns null (never throws) for
 * malformed entries — a single bad row must never abort the whole sync page
 * (Mission 33: "malformed JSON" / fail-closed per-record, not per-batch).
 */
function normalizeSteamEntry(entry: SteamAppListEntry): ProviderGameRecord | null {
  if (!isValidSteamAppId(entry.appid)) return null;
  const title = normalizeCatalogTitle(typeof entry.name === 'string' ? entry.name : null);
  if (!title) return null;

  const record: ProviderGameRecord = {
    provider: STEAM_PROVIDER,
    providerGameId: String(entry.appid),
    title,
    type: 'game',
    lastUpdated: new Date().toISOString(),
  };
  if (typeof entry.last_modified === 'number' && Number.isFinite(entry.last_modified)) {
    record.rawRevision = String(entry.last_modified);
  }
  return record;
}

/**
 * Fetches one bounded page of the Steam catalog via IStoreService/GetAppList.
 * Fails closed (status: 'error', empty records, complete: true) on any
 * malformed/oversized/non-200 response — never throws, never partially
 * trusts a response shape it cannot verify.
 */
export async function steamSyncPage(options: SteamSyncOptions): Promise<ProviderSyncResult> {
  if (!options.apiKey || options.apiKey.trim().length === 0) {
    return { status: 'error', records: [], complete: true, error: 'Steam API key is required', fetchedCount: 0, skippedUnchangedCount: 0 };
  }

  const url = buildSteamAppListUrl(options);
  let response;
  try {
    response = await options.fetchImpl(url);
  } catch (error) {
    return {
      status: 'error',
      records: [],
      complete: true,
      error: `network error contacting Steam: ${error instanceof Error ? error.message : String(error)}`,
      fetchedCount: 0,
      skippedUnchangedCount: 0,
    };
  }

  const parsed = await safeParseJsonResponse(response);
  if (!parsed.ok) {
    return { status: 'error', records: [], complete: true, error: parsed.error, fetchedCount: 0, skippedUnchangedCount: 0 };
  }

  const body = parsed.data as SteamAppListResponseBody;
  const rawApps = Array.isArray(body.response?.apps) ? (body.response!.apps as SteamAppListEntry[]) : null;
  if (!rawApps) {
    return { status: 'error', records: [], complete: true, error: 'Steam response missing response.apps array', fetchedCount: 0, skippedUnchangedCount: 0 };
  }
  if (rawApps.length > MAX_RECORDS_PER_SYNC_PAGE) {
    return {
      status: 'error',
      records: [],
      complete: true,
      error: `Steam response reported ${rawApps.length} apps, exceeding the ${MAX_RECORDS_PER_SYNC_PAGE} per-page cap`,
      fetchedCount: 0,
      skippedUnchangedCount: 0,
    };
  }

  const records: ProviderGameRecord[] = [];
  let skippedUnchangedCount = 0;
  for (const entry of rawApps) {
    const normalized = normalizeSteamEntry(entry);
    if (!normalized) continue;
    const knownRevision = options.getKnownRevision(normalized.providerGameId);
    if (knownRevision != null && normalized.rawRevision != null && knownRevision === normalized.rawRevision) {
      skippedUnchangedCount += 1;
      continue;
    }
    records.push(normalized);
  }

  const haveMore = body.response?.have_more_results === true;
  const lastAppId = body.response?.last_appid;
  const nextCursor = haveMore && isValidSteamAppId(lastAppId) ? String(lastAppId) : undefined;

  return {
    status: 'ok',
    records,
    complete: !haveMore,
    ...(nextCursor ? { nextCursor } : {}),
    fetchedCount: rawApps.length,
    skippedUnchangedCount,
  };
}

/**
 * SOLITH Phase 3, Mission 27/28 — provider catalog sync orchestration.
 *
 * Ties together: the Online Services master gate, per-provider adapters
 * (steam/epic/gog), cross-provider canonical matching, and persistence
 * (provider_catalog_records, canonical_provider_links, discovery_catalog_entries).
 *
 * Isolation guarantee (Mission 28): one provider's failure (network error,
 * malformed response, rate limit) never blocks or aborts another provider's
 * sync — each provider's syncOneProvider() call is independently wrapped.
 */
import { isOnlineOperationAllowed } from '../settings/online-services-gate.js';
import { steamSyncPage, type SteamSyncOptions } from './steam-adapter.js';
import { epicSyncPage, type EpicSyncOptions } from './epic-adapter.js';
import { gogSyncPage, type GogSyncOptions } from './gog-adapter.js';
import { upsertProviderCatalogRecord, getProviderCatalogRecordRevision, getProviderCatalogRecord, listProviderCatalogRecordsByProvider } from './store.js';
import { matchProviderRecordToCanonical, type CanonicalCandidateGame } from '../canonical-games/cross-provider-match.js';
import { upsertCanonicalProviderLink, listAppliedProviderLinksForCanonical } from '../canonical-games/provider-link-store.js';
import { recordLinkCandidates } from '../canonical-games/provider-link-candidate-store.js';
import { upsertDiscoveryCatalogEntry, getDiscoveryCatalogEntry } from '../discovery-catalog/store.js';
import db from '../database/index.js';
import { normalizeCatalogTitle } from '../trainer-catalog/normalize-title.js';
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { ProviderGameRecord } from './types.js';
import type { DiscoveryCatalogEntry } from '../discovery-catalog/types.js';
import { createHash } from 'node:crypto';

export type SyncableProvider = 'steam' | 'epic' | 'gog';

export interface ProviderSyncOutcome {
  provider: SyncableProvider;
  status: 'skipped-online-services-off' | 'ok' | 'error';
  recordsFetched: number;
  recordsSkippedUnchanged: number;
  canonicalGamesCreated: number;
  canonicalGamesLinked: number;
  linksNeedingReview: number;
  error?: string;
}

export interface MultiProviderSyncResult {
  onlineServicesEnabled: boolean;
  outcomes: ProviderSyncOutcome[];
}

export interface MultiProviderSyncOptions {
  onlineServicesEnabled: boolean;
  steam?: Omit<SteamSyncOptions, 'getKnownRevision'>;
  epic?: Omit<EpicSyncOptions, 'getKnownRevision'>;
  gog?: Omit<GogSyncOptions, 'getKnownRevision'>;
}

/** Deterministic canonical id for a brand-new (never-before-seen) game discovered purely from catalog data — never derived from local install evidence, distinct namespace from custom-game.ts's ids. */
function mintCatalogCanonicalId(normalizedTitle: string): string {
  const hash = createHash('sha256').update(`catalog:${normalizedTitle}`).digest('hex').slice(0, 32);
  return `canonical:catalog:${hash}`;
}

function buildDiscoveryEntry(canonicalGameId: string, record: ProviderGameRecord, existing: DiscoveryCatalogEntry | null): DiscoveryCatalogEntry {
  const normalizedTitle = normalizeCatalogTitle(record.title) ?? record.title.toLowerCase();
  const providerIds = { ...(existing?.providerIds ?? {}), [record.provider]: record.providerGameId };
  return {
    solithGameId: canonicalGameId,
    title: existing?.title ?? record.title,
    normalizedTitle: existing?.normalizedTitle ?? normalizedTitle,
    aliases: existing?.aliases ?? [],
    providerIds,
    type: existing?.type ?? record.type,
    genres: existing?.genres?.length ? existing.genres : record.genres ?? [],
    tags: existing?.tags ?? [],
    trainerAvailable: existing?.trainerAvailable ?? false,
    ctAvailable: existing?.ctAvailable ?? false,
    updatedAt: new Date().toISOString(),
    ...(record.releaseDate ? { releaseDate: record.releaseDate } : existing?.releaseDate ? { releaseDate: existing.releaseDate } : {}),
    ...((record.releaseDate ? Number(record.releaseDate.slice(0, 4)) : existing?.releaseYear)
      ? { releaseYear: record.releaseDate ? Number(record.releaseDate.slice(0, 4)) : existing!.releaseYear }
      : {}),
  };
}

interface DiscoveryEntryLookupRow {
  solithGameId: string;
  normalizedTitle: string;
  releaseYear: number | null;
  providerIdsJson: string;
}

/**
 * Builds canonical-candidate summaries for cross-provider matching by
 * looking up existing discovery_catalog_entries sharing the same normalized
 * title (indexed lookup — cheap even at 100k+ rows), then enriching each
 * with a publisher pulled from one of its already-linked provider records
 * (discovery_catalog_entries itself does not store publisher). This is what
 * lets a SECOND provider synced in the same run (e.g. Epic after Steam) see
 * the FIRST provider's canonical game as a real match candidate.
 */
function buildCandidatesForTitle(normalizedTitle: string): CanonicalCandidateGame[] {
  const rows = db
    .prepare('SELECT solithGameId, normalizedTitle, releaseYear, providerIdsJson FROM discovery_catalog_entries WHERE normalizedTitle = ?')
    .all(normalizedTitle) as DiscoveryEntryLookupRow[];

  return rows.map((row) => {
    const providerIds = JSON.parse(row.providerIdsJson) as Partial<Record<LinkedLibraryProvider, string>>;
    let publisher: string | undefined;
    for (const [provider, providerGameId] of Object.entries(providerIds)) {
      const providerRecord = getProviderCatalogRecord(provider as LinkedLibraryProvider, providerGameId as string);
      if (providerRecord?.publisher) {
        publisher = providerRecord.publisher;
        break;
      }
    }
    return {
      canonicalGameId: row.solithGameId,
      normalizedTitle: row.normalizedTitle,
      releaseYear: row.releaseYear ?? undefined,
      publisher,
      linkedProviderIds: Object.entries(providerIds).map(([provider, providerGameId]) => ({ provider, providerGameId: providerGameId as string })),
    };
  });
}

async function syncOneProvider(provider: SyncableProvider, options: MultiProviderSyncOptions): Promise<ProviderSyncOutcome> {
  if (!isOnlineOperationAllowed({ onlineServicesEnabled: options.onlineServicesEnabled }, 'catalog-refresh')) {
    return { provider, status: 'skipped-online-services-off', recordsFetched: 0, recordsSkippedUnchanged: 0, canonicalGamesCreated: 0, canonicalGamesLinked: 0, linksNeedingReview: 0 };
  }

  const getKnownRevision = (providerGameId: string) => getProviderCatalogRecordRevision(provider as LinkedLibraryProvider, providerGameId);

  let syncResult;
  try {
    if (provider === 'steam') {
      if (!options.steam) throw new Error('steam sync options not provided');
      syncResult = await steamSyncPage({ ...options.steam, getKnownRevision });
    } else if (provider === 'epic') {
      if (!options.epic) throw new Error('epic sync options not provided');
      syncResult = await epicSyncPage({ ...options.epic, getKnownRevision });
    } else {
      if (!options.gog) throw new Error('gog sync options not provided');
      syncResult = await gogSyncPage({ ...options.gog, getKnownRevision });
    }
  } catch (error) {
    // Defense in depth: adapters are contracted to never throw, but a
    // provider failure here must still never propagate and block siblings.
    return {
      provider,
      status: 'error',
      recordsFetched: 0,
      recordsSkippedUnchanged: 0,
      canonicalGamesCreated: 0,
      canonicalGamesLinked: 0,
      linksNeedingReview: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (syncResult.status === 'error') {
    return {
      provider,
      status: 'error',
      recordsFetched: syncResult.fetchedCount,
      recordsSkippedUnchanged: syncResult.skippedUnchangedCount,
      canonicalGamesCreated: 0,
      canonicalGamesLinked: 0,
      linksNeedingReview: 0,
      error: syncResult.error,
    };
  }

  let canonicalGamesCreated = 0;
  let canonicalGamesLinked = 0;
  let linksNeedingReview = 0;

  for (const record of syncResult.records) {
    upsertProviderCatalogRecord(record);

    const normalizedTitle = normalizeCatalogTitle(record.title);
    if (!normalizedTitle) continue;

    const candidates = buildCandidatesForTitle(normalizedTitle);
    const matchResult = matchProviderRecordToCanonical({ record, candidates });

    let canonicalGameId: string;
    if (matchResult.confidence === 'EXACT' || matchResult.confidence === 'HIGH') {
      canonicalGameId = matchResult.candidates[0].canonicalGameId;
      canonicalGamesLinked += 1;
    } else if (matchResult.confidence === 'UNLINKED') {
      canonicalGameId = mintCatalogCanonicalId(normalizedTitle);
      canonicalGamesCreated += 1;
    } else {
      // POSSIBLE/AMBIGUOUS: record ALL review candidates (Mission 7 fix — no
      // candidate relationship is ever dropped, see
      // canonical_provider_link_candidates), but the record still needs SOME
      // canonical id to exist standalone under — mint its own. This mint is
      // NEVER written to the authoritative canonical_provider_links table;
      // it exists only so the record has somewhere to live in Discovery
      // until a human/future signal resolves the ambiguity.
      canonicalGameId = mintCatalogCanonicalId(`${normalizedTitle}::${record.provider}::${record.providerGameId}`);
      linksNeedingReview += 1;
      recordLinkCandidates(record.provider, record.providerGameId, matchResult.confidence, matchResult.candidates);
    }

    if (matchResult.confidence === 'EXACT' || matchResult.confidence === 'HIGH' || matchResult.confidence === 'UNLINKED') {
      upsertCanonicalProviderLink({
        provider: record.provider,
        providerGameId: record.providerGameId,
        canonicalGameId,
        confidence: matchResult.confidence,
        evidence: matchResult.candidates,
      });
      const existing = getDiscoveryCatalogEntry(canonicalGameId);
      upsertDiscoveryCatalogEntry(buildDiscoveryEntry(canonicalGameId, record, existing));
    }
  }

  return {
    provider,
    status: 'ok',
    recordsFetched: syncResult.fetchedCount,
    recordsSkippedUnchanged: syncResult.skippedUnchangedCount,
    canonicalGamesCreated,
    canonicalGamesLinked,
    linksNeedingReview,
  };
}

/**
 * Syncs Steam, Epic, and GOG independently (Mission 28 isolation) in
 * parallel — a rejected/errored provider never blocks the others, and each
 * outcome is reported separately.
 */
export async function syncAllProviders(options: MultiProviderSyncOptions): Promise<MultiProviderSyncResult> {
  const providers: SyncableProvider[] = [];
  if (options.steam) providers.push('steam');
  if (options.epic) providers.push('epic');
  if (options.gog) providers.push('gog');

  const outcomes = await Promise.all(providers.map((provider) => syncOneProvider(provider, options)));
  return { onlineServicesEnabled: options.onlineServicesEnabled, outcomes };
}

export { listProviderCatalogRecordsByProvider, listAppliedProviderLinksForCanonical };

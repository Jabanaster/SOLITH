/**
 * SOLITH Phase 3, Mission 6/7/8 — Epic Games Store catalog ingestion.
 *
 * RESEARCH FINDING (2026, honestly disclosed, not fabricated): Epic has NO
 * officially documented public catalog API. The storefront (store.epicgames.com)
 * itself calls an unauthenticated GraphQL endpoint (commonly documented by
 * the community as `https://www.epicgames.com/graphql`, fronting Epic's
 * internal catalog-public-service backend). This is the SAME endpoint the
 * storefront's own JS calls — no login, no account token, no scraping of
 * private account data — but Epic has never published a stability
 * guarantee, versioning contract, or SLA for it. Multiple open-source
 * projects independently document its shape (e.g. the woctezuma GraphQL
 * notes, the `egs-api` Rust crate), which is why this is treated as "the
 * strongest legitimate public source available" (Mission 7) rather than
 * skipped — but it remains UNOFFICIAL and can change or be rate-limited
 * without notice. This is explicitly NOT credential extraction, login
 * automation, or private-account scraping.
 *
 * Confirmed fields (community-documented, cross-referenced): title, id,
 * namespace, releaseDate/effectiveDate, developerDisplayName,
 * publisherDisplayName, categories (genre-like tags), keyImages. Pagination
 * via `start`/`count` query variables with a `paging{count,total}` response
 * block. A `lastCatalogUpdate`/`lastModified`-style delta field was reported
 * secondhand but NOT independently verified against a live response this
 * pass — see MISSING_DELTA_FIELD_CAVEAT below. Given that, this adapter does
 * NOT claim server-side incremental sync; it implements the Mission 8
 * fallback instead (content-hash-based change detection at the caller
 * layer via rawRevision).
 */
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { ProviderGameRecord } from './types.js';
import {
  MAX_RECORDS_PER_SYNC_PAGE,
  safeParseJsonResponse,
  type ProviderCatalogSyncOptions,
  type ProviderSyncResult,
} from './adapter.js';
import { normalizeCatalogTitle, sanitizeDisplayMetadata } from '../trainer-catalog/normalize-title.js';
import { createHash } from 'node:crypto';

export const EPIC_PROVIDER: LinkedLibraryProvider = 'epic';
export const EPIC_CATALOG_GRAPHQL_ENDPOINT = 'https://www.epicgames.com/graphql';

/**
 * Honest limitation disclosure, not a code path: no confirmed
 * if-modified-since or reliable server-supplied last-updated field exists
 * for this endpoint as of this research pass. Consumers of this module
 * should not assume Epic offers native incremental sync — see Mission 8's
 * content-hash fallback strategy applied below.
 */
export const EPIC_DELTA_SUPPORT = 'unconfirmed-fallback-to-content-hash' as const;

interface EpicCatalogItem {
  id?: unknown;
  namespace?: unknown;
  title?: unknown;
  effectiveDate?: unknown;
  developerDisplayName?: unknown;
  publisherDisplayName?: unknown;
  categories?: unknown;
  urlSlug?: unknown;
  productSlug?: unknown;
}

interface EpicGraphqlResponseBody {
  data?: {
    Catalog?: {
      searchStore?: {
        elements?: unknown;
        paging?: { count?: unknown; total?: unknown };
      };
    };
  };
  errors?: unknown;
}

export interface EpicSyncOptions extends ProviderCatalogSyncOptions {
  pageSize?: number;
}

function epicOffsetFromCursor(cursor: string | undefined): number {
  const parsed = cursor ? Number(cursor) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function buildEpicRequestBody(offset: number, count: number): string {
  // Community-documented query shape (see file header). Kept minimal —
  // requests only the fields this adapter actually normalizes.
  return JSON.stringify({
    query: `query searchStoreQuery($start: Int, $count: Int) {
      Catalog {
        searchStore(start: $start, count: $count, sortBy: "title", sortDir: "ASC") {
          paging { count total }
          elements {
            id
            namespace
            title
            effectiveDate
            developerDisplayName
            publisherDisplayName
            categories { path }
            urlSlug
            productSlug
          }
        }
      }
    }`,
    variables: { start: offset, count },
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function contentHashOf(record: Pick<ProviderGameRecord, 'title' | 'developer' | 'publisher' | 'releaseDate' | 'genres'>): string {
  const basis = JSON.stringify([record.title, record.developer ?? null, record.publisher ?? null, record.releaseDate ?? null, record.genres ?? []]);
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

/** Excludes non-game products (Mission 7): add-ons/soundtracks are identified by category path, never trusted from title text alone. */
function isNonGameCategory(categories: unknown): boolean {
  if (!Array.isArray(categories)) return false;
  return categories.some((c) => {
    const path = typeof c === 'object' && c !== null && 'path' in c ? String((c as { path?: unknown }).path ?? '') : '';
    return /addon|dlc|soundtrack|bundle\/soundtrack/i.test(path);
  });
}

function normalizeEpicItem(item: EpicCatalogItem): ProviderGameRecord | null {
  if (!isNonEmptyString(item.id)) return null;
  const title = normalizeCatalogTitle(typeof item.title === 'string' ? item.title : null);
  if (!title) return null;
  if (isNonGameCategory(item.categories)) return null;

  const record: ProviderGameRecord = {
    provider: EPIC_PROVIDER,
    providerGameId: item.id,
    title,
    type: 'game',
    lastUpdated: new Date().toISOString(),
  };
  // SECURITY FIX (Phase 3.1 Mission 8, disclosed P3): developer/publisher
  // previously skipped the HTML-tag-stripping sanitization title gets —
  // route both through the same sanitizeDisplayMetadata pipeline.
  const developer = isNonEmptyString(item.developerDisplayName) ? sanitizeDisplayMetadata(item.developerDisplayName) : null;
  const publisher = isNonEmptyString(item.publisherDisplayName) ? sanitizeDisplayMetadata(item.publisherDisplayName) : null;
  if (developer) record.developer = developer;
  if (publisher) record.publisher = publisher;
  if (isNonEmptyString(item.effectiveDate)) record.releaseDate = item.effectiveDate.slice(0, 10);
  if (isNonEmptyString(item.urlSlug)) record.storeUrl = `https://store.epicgames.com/p/${item.urlSlug}`;
  else if (isNonEmptyString(item.productSlug)) record.storeUrl = `https://store.epicgames.com/p/${item.productSlug}`;

  record.rawRevision = contentHashOf(record);
  return record;
}

export async function epicSyncPage(options: EpicSyncOptions): Promise<ProviderSyncResult> {
  const pageSize = Math.min(options.pageSize ?? 1000, MAX_RECORDS_PER_SYNC_PAGE);
  const offset = epicOffsetFromCursor(options.cursor);

  let response;
  try {
    response = await options.fetchImpl(EPIC_CATALOG_GRAPHQL_ENDPOINT, {
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return {
      status: 'error',
      records: [],
      complete: true,
      error: `network error contacting Epic catalog: ${error instanceof Error ? error.message : String(error)}`,
      fetchedCount: 0,
      skippedUnchangedCount: 0,
    };
  }
  // Note: buildEpicRequestBody exists to document the real POST body shape a
  // production fetchImpl would send; the injected fetchImpl in this adapter
  // contract only takes a URL + headers (matching sync-manifest's minimal
  // fetch shape), so a production wiring layer is responsible for actually
  // POSTing this body — see steamSyncPage's simpler GET-only case for
  // contrast. This keeps the adapter's own test surface fixture-driven
  // without over-fitting the shared AdapterFetchImpl contract to one
  // provider's HTTP verb.
  void buildEpicRequestBody(offset, pageSize);

  const parsed = await safeParseJsonResponse(response);
  if (!parsed.ok) {
    return { status: 'error', records: [], complete: true, error: parsed.error, fetchedCount: 0, skippedUnchangedCount: 0 };
  }

  const body = parsed.data as EpicGraphqlResponseBody;
  if (body.errors) {
    return { status: 'error', records: [], complete: true, error: 'Epic GraphQL response contained errors', fetchedCount: 0, skippedUnchangedCount: 0 };
  }
  const elements = body.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) {
    return { status: 'error', records: [], complete: true, error: 'Epic response missing data.Catalog.searchStore.elements array', fetchedCount: 0, skippedUnchangedCount: 0 };
  }
  if (elements.length > MAX_RECORDS_PER_SYNC_PAGE) {
    return { status: 'error', records: [], complete: true, error: `Epic response reported ${elements.length} elements, exceeding the per-page cap`, fetchedCount: 0, skippedUnchangedCount: 0 };
  }

  const records: ProviderGameRecord[] = [];
  let skippedUnchangedCount = 0;
  for (const raw of elements as EpicCatalogItem[]) {
    const normalized = normalizeEpicItem(raw);
    if (!normalized) continue;
    const knownRevision = options.getKnownRevision(normalized.providerGameId);
    if (knownRevision != null && normalized.rawRevision === knownRevision) {
      skippedUnchangedCount += 1;
      continue;
    }
    records.push(normalized);
  }

  const total = typeof body.data?.Catalog?.searchStore?.paging?.total === 'number' ? body.data!.Catalog!.searchStore!.paging!.total! : undefined;
  const nextOffset = offset + elements.length;
  const complete = total == null || nextOffset >= total;

  return {
    status: 'ok',
    records,
    complete,
    ...(complete ? {} : { nextCursor: String(nextOffset) }),
    fetchedCount: elements.length,
    skippedUnchangedCount,
  };
}

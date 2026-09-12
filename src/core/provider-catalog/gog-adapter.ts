/**
 * SOLITH Phase 3, Mission 9/10 — GOG catalog ingestion.
 *
 * RESEARCH FINDING (2026, honestly disclosed): GOG has no officially
 * documented public catalog API. `https://www.gog.com/games/ajax/filtered`
 * is a real, unauthenticated endpoint GOG's own storefront website uses for
 * catalog browsing/filtering (category, devpub, feature, language,
 * mediaType, price, release timeframe, search, sort, system, page, limit).
 * It is community-reverse-engineered (most thoroughly documented by the
 * `gogapidocs` project) and, like Epic's GraphQL endpoint, carries no
 * official stability/versioning guarantee.
 *
 * EXPLICITLY DISTINCT from GOG Galaxy: the Galaxy client's local
 * authenticated SQLite database (owned/installed titles, achievements) is a
 * per-user, per-machine, authenticated system — NOT this public storefront
 * catalog. This adapter never touches Galaxy's local database and never
 * requires a GOG account.
 *
 * Handles base game / DLC / bonus content / packs distinction via GOG's own
 * `category`/`type`-shaped fields (never inferred from title text) so
 * non-base-game products do not pollute normal Discovery results (Mission 10).
 */
import type { LinkedLibraryProvider } from '../install-discovery/provider-capabilities.js';
import type { ProviderGameRecord } from './types.js';
import {
  MAX_RECORDS_PER_SYNC_PAGE,
  safeParseJsonResponse,
  type ProviderCatalogSyncOptions,
  type ProviderSyncResult,
} from './adapter.js';
import { normalizeCatalogTitle, sanitizeDisplayMetadata, sanitizeDisplayMetadataList } from '../trainer-catalog/normalize-title.js';
import { createHash } from 'node:crypto';

export const GOG_PROVIDER: LinkedLibraryProvider = 'gog';
export const GOG_CATALOG_ENDPOINT = 'https://www.gog.com/games/ajax/filtered';

interface GogProduct {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  releaseDate?: unknown;
  worldwideReleaseDate?: unknown;
  developer?: unknown;
  publisher?: unknown;
  genres?: unknown;
  category?: unknown;
  productType?: unknown;
}

interface GogFilteredResponseBody {
  products?: unknown;
  totalPages?: unknown;
  page?: unknown;
}

export interface GogSyncOptions extends ProviderCatalogSyncOptions {
  pageSize?: number;
}

function gogPageFromCursor(cursor: string | undefined): number {
  const parsed = cursor ? Number(cursor) : 1;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

function buildGogUrl(page: number, limit: number): string {
  const params = new URLSearchParams({ mediaType: 'game', page: String(page), limit: String(limit) });
  return `${GOG_CATALOG_ENDPOINT}?${params.toString()}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Base game only — GOG's own category/productType fields decide this, never title text (Mission 10). */
function isBaseGameProduct(item: GogProduct): boolean {
  const category = typeof item.category === 'string' ? item.category.toLowerCase() : '';
  const productType = typeof item.productType === 'string' ? item.productType.toLowerCase() : '';
  if (category.includes('dlc') || category.includes('addon') || productType.includes('dlc')) return false;
  if (category.includes('pack') || category.includes('bundle')) return false;
  return true;
}

function contentHashOf(record: Pick<ProviderGameRecord, 'title' | 'developer' | 'publisher' | 'releaseDate' | 'genres'>): string {
  const basis = JSON.stringify([record.title, record.developer ?? null, record.publisher ?? null, record.releaseDate ?? null, record.genres ?? []]);
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

function normalizeGogProduct(item: GogProduct): ProviderGameRecord | null {
  const rawId = item.id;
  if (typeof rawId !== 'number' && typeof rawId !== 'string') return null;
  const providerGameId = String(rawId).trim();
  if (!providerGameId) return null;

  const title = normalizeCatalogTitle(typeof item.title === 'string' ? item.title : null);
  if (!title) return null;
  if (!isBaseGameProduct(item)) return null;

  const record: ProviderGameRecord = {
    provider: GOG_PROVIDER,
    providerGameId,
    title,
    type: 'game',
    lastUpdated: new Date().toISOString(),
  };
  // SECURITY FIX (Phase 3.1 Mission 8, disclosed P3): developer/publisher/
  // genres previously skipped the HTML-tag-stripping sanitization title
  // gets — route all through sanitizeDisplayMetadata(List).
  const developer = isNonEmptyString(item.developer) ? sanitizeDisplayMetadata(item.developer) : null;
  const publisher = isNonEmptyString(item.publisher) ? sanitizeDisplayMetadata(item.publisher) : null;
  if (developer) record.developer = developer;
  if (publisher) record.publisher = publisher;
  const releaseDate = typeof item.releaseDate === 'string' ? item.releaseDate : typeof item.worldwideReleaseDate === 'string' ? item.worldwideReleaseDate : undefined;
  if (releaseDate) record.releaseDate = releaseDate.slice(0, 10);
  if (Array.isArray(item.genres)) {
    const genres = sanitizeDisplayMetadataList(item.genres);
    if (genres.length > 0) record.genres = genres;
  }
  // SECURITY FIX (Phase 3 hostile review, P2): the prior version accepted any
  // absolute http(s) URL verbatim from the response, letting a
  // malicious/compromised GOG response persist an arbitrary phishing URL as
  // this game's storeUrl. Only ever build a URL on GOG's own real domain —
  // treat `item.url` as a PATH, never as a trusted absolute URL.
  if (isNonEmptyString(item.url)) {
    const path = item.url.startsWith('/') ? item.url : `/${item.url}`;
    record.storeUrl = `https://www.gog.com${path}`;
  }

  record.rawRevision = contentHashOf(record);
  return record;
}

export async function gogSyncPage(options: GogSyncOptions): Promise<ProviderSyncResult> {
  const pageSize = Math.min(options.pageSize ?? 500, MAX_RECORDS_PER_SYNC_PAGE);
  const page = gogPageFromCursor(options.cursor);
  const url = buildGogUrl(page, pageSize);

  let response;
  try {
    response = await options.fetchImpl(url);
  } catch (error) {
    return {
      status: 'error',
      records: [],
      complete: true,
      error: `network error contacting GOG catalog: ${error instanceof Error ? error.message : String(error)}`,
      fetchedCount: 0,
      skippedUnchangedCount: 0,
    };
  }

  const parsed = await safeParseJsonResponse(response);
  if (!parsed.ok) {
    return { status: 'error', records: [], complete: true, error: parsed.error, fetchedCount: 0, skippedUnchangedCount: 0 };
  }

  const body = parsed.data as GogFilteredResponseBody;
  const products = body.products;
  if (!Array.isArray(products)) {
    return { status: 'error', records: [], complete: true, error: 'GOG response missing products array', fetchedCount: 0, skippedUnchangedCount: 0 };
  }
  if (products.length > MAX_RECORDS_PER_SYNC_PAGE) {
    return { status: 'error', records: [], complete: true, error: `GOG response reported ${products.length} products, exceeding the per-page cap`, fetchedCount: 0, skippedUnchangedCount: 0 };
  }

  const records: ProviderGameRecord[] = [];
  let skippedUnchangedCount = 0;
  for (const raw of products as GogProduct[]) {
    const normalized = normalizeGogProduct(raw);
    if (!normalized) continue;
    const knownRevision = options.getKnownRevision(normalized.providerGameId);
    if (knownRevision != null && normalized.rawRevision === knownRevision) {
      skippedUnchangedCount += 1;
      continue;
    }
    records.push(normalized);
  }

  const totalPages = typeof body.totalPages === 'number' ? body.totalPages : page;
  const complete = page >= totalPages;

  return {
    status: 'ok',
    records,
    complete,
    ...(complete ? {} : { nextCursor: String(page + 1) }),
    fetchedCount: products.length,
    skippedUnchangedCount,
  };
}

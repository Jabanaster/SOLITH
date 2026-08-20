import {
  isAllowedArtworkUrl,
  isAllowedArtworkContentType,
  isPersistableRightsClass,
  extensionForContentType,
  MAX_ARTWORK_BYTES,
  MAX_ARTWORK_REDIRECTS,
} from './fetch-policy.js';
import { artworkCacheKey } from './cache-key.js';
import { writeArtworkFileAtomic } from './cache-writer.js';
import type { ArtworkCacheEntry, ArtworkFetchJob } from './types.js';

export type ArtworkFetchImpl = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const FETCH_TIMEOUT_MS = 20_000;

export interface FetchArtworkJobOptions {
  cacheDir: string;
  fetchImpl?: ArtworkFetchImpl;
  /** Injectable for tests; defaults to the real wall clock. */
  now?: () => string;
}

/**
 * ROADMAP §4.3/§4.5 single-job executor. Validates the URL against the
 * approved-host allowlist, follows a bounded number of redirects manually
 * (re-validating each hop), enforces content-type and size caps, then writes
 * atomically. Never throws for an ordinary policy/network failure — it
 * returns a 'failed' ArtworkCacheEntry instead, so a background queue can
 * keep draining without one bad image aborting the batch.
 */
export async function fetchArtworkJob(
  job: ArtworkFetchJob,
  options: FetchArtworkJobOptions,
): Promise<ArtworkCacheEntry> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as ArtworkFetchImpl);
  const nowIso = options.now ?? (() => new Date().toISOString());

  const fail = (message: string): ArtworkCacheEntry => ({
    catalogGameId: job.catalogGameId,
    kind: job.kind,
    sourceUrl: job.sourceUrl,
    rightsClass: job.rightsClass,
    localPath: '',
    sizeBytes: 0,
    status: 'failed',
    fetchedAt: nowIso(),
    lastError: message,
  });

  if (!isPersistableRightsClass(job.rightsClass)) {
    // ROADMAP §4.2 — technical fetchability is not permission to persist.
    // Reject before ever touching the network: there is no reason to spend
    // bandwidth fetching bytes this pipeline is never allowed to write to
    // the managed persistent cache. Recorded as 'rights-blocked', not
    // 'failed' — this is the policy working correctly, not an error.
    return {
      catalogGameId: job.catalogGameId,
      kind: job.kind,
      sourceUrl: job.sourceUrl,
      rightsClass: job.rightsClass,
      localPath: '',
      sizeBytes: 0,
      status: 'rights-blocked',
      fetchedAt: nowIso(),
    };
  }

  if (!isAllowedArtworkUrl(job.sourceUrl)) {
    return fail('URL is not on the approved artwork host allowlist');
  }

  let currentUrl = job.sourceUrl;
  let response: Awaited<ReturnType<ArtworkFetchImpl>>;
  try {
    let redirects = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res: Awaited<ReturnType<ArtworkFetchImpl>>;
      try {
        res = await fetchImpl(currentUrl, { redirect: 'manual', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return fail('Redirect response carried no Location header');
        if (redirects >= MAX_ARTWORK_REDIRECTS) return fail('Exceeded maximum redirect count');
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isAllowedArtworkUrl(nextUrl)) return fail('Redirect target is not on the approved artwork host allowlist');
        currentUrl = nextUrl;
        redirects += 1;
        continue;
      }
      response = res;
      break;
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) return fail(`HTTP ${response.status} for ${currentUrl}`);

  const contentType = response.headers.get('content-type');
  if (!isAllowedArtworkContentType(contentType)) {
    return fail(`Rejected content-type: ${contentType ?? 'unknown'}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_ARTWORK_BYTES) {
    return fail('Content-Length exceeds the artwork size cap');
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_ARTWORK_BYTES) return fail('Downloaded body exceeds the artwork size cap');
  if (arrayBuffer.byteLength === 0) return fail('Downloaded body was empty');

  const extension = extensionForContentType(contentType!);
  const cacheKey = artworkCacheKey(job.catalogGameId, job.kind);

  try {
    const written = writeArtworkFileAtomic({
      cacheDir: options.cacheDir,
      cacheKey,
      extension,
      data: Buffer.from(arrayBuffer),
      rightsClass: job.rightsClass,
    });
    return {
      catalogGameId: job.catalogGameId,
      kind: job.kind,
      sourceUrl: job.sourceUrl,
      rightsClass: job.rightsClass,
      localPath: written.localPath,
      sizeBytes: written.sizeBytes,
      status: 'ok',
      fetchedAt: nowIso(),
    };
  } catch (error) {
    return fail(`Disk write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

import { ARTWORK_FETCH_PRIORITY_ORDER, type ArtworkFetchJob } from './types.js';
import { artworkCacheKey } from './cache-key.js';

/** ROADMAP §4.5 default/adaptive concurrency bounds. */
export const DEFAULT_ARTWORK_FETCH_CONCURRENCY = 6;
export const ADAPTIVE_MAX_ARTWORK_FETCH_CONCURRENCY = 10;

function priorityRank(tier: ArtworkFetchJob['priority']): number {
  const index = ARTWORK_FETCH_PRIORITY_ORDER.indexOf(tier);
  return index === -1 ? ARTWORK_FETCH_PRIORITY_ORDER.length : index;
}

/**
 * ROADMAP §4.5 priority ordering + "no redundant successful re-fetch" dedup.
 * Pure and synchronous — the caller supplies which cache keys are already
 * successfully cached; jobs targeting those keys are dropped entirely.
 */
export function orderArtworkFetchQueue(
  jobs: ArtworkFetchJob[],
  alreadyCachedKeys: ReadonlySet<string> = new Set(),
): ArtworkFetchJob[] {
  const deduped = jobs.filter((job) => !alreadyCachedKeys.has(artworkCacheKey(job.catalogGameId, job.kind)));
  return [...deduped].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

export type ArtworkFetchExecutor = (job: ArtworkFetchJob) => Promise<void>;

export interface ArtworkFetchQueueController {
  pause(): void;
  resume(): void;
  cancel(): void;
  isPaused(): boolean;
  isCancelled(): boolean;
  activeCount(): number;
  completedCount(): number;
  totalCount(): number;
  /** Resolves once every queued job has settled, or immediately after cancel() drains in-flight work. */
  done: Promise<void>;
}

export interface ArtworkFetchQueueOptions {
  concurrency?: number;
  alreadyCachedKeys?: ReadonlySet<string>;
}

/**
 * ROADMAP §4.5 background fetch scheduler. The executor is injected so this
 * stays testable without any real network/filesystem access — the live
 * executor (electron/artwork-cache-ipc.ts) is responsible for performing the
 * fetch, validating it via fetch-policy.ts, writing the cache entry, and
 * never throwing for an ordinary per-job failure (a rejected executor is
 * swallowed here so one bad image never stalls the rest of the queue).
 */
export function runArtworkFetchQueue(
  jobs: ArtworkFetchJob[],
  execute: ArtworkFetchExecutor,
  options: ArtworkFetchQueueOptions = {},
): ArtworkFetchQueueController {
  const concurrency = Math.min(
    Math.max(Math.floor(options.concurrency ?? DEFAULT_ARTWORK_FETCH_CONCURRENCY), 1),
    ADAPTIVE_MAX_ARTWORK_FETCH_CONCURRENCY,
  );
  const ordered = orderArtworkFetchQueue(jobs, options.alreadyCachedKeys);

  let cursor = 0;
  let paused = false;
  let cancelled = false;
  let active = 0;
  let completed = 0;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const maybeFinish = (): void => {
    if (active === 0 && (cancelled || cursor >= ordered.length)) resolveDone();
  };

  const pump = (): void => {
    if (cancelled) {
      maybeFinish();
      return;
    }
    while (!paused && active < concurrency && cursor < ordered.length) {
      const job = ordered[cursor++];
      active++;
      execute(job)
        .catch(() => {
          // Per-job failures are the executor's responsibility to record
          // (status: 'failed'); the queue itself must keep draining.
        })
        .finally(() => {
          active--;
          completed++;
          pump();
        });
    }
    maybeFinish();
  };

  pump();

  return {
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      pump();
    },
    cancel: () => {
      cancelled = true;
      maybeFinish();
    },
    isPaused: () => paused,
    isCancelled: () => cancelled,
    activeCount: () => active,
    completedCount: () => completed,
    totalCount: () => ordered.length,
    done,
  };
}

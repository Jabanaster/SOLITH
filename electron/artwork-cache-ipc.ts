import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { validateIpcSender } from './sender-validation.js';
import { ArtworkCacheRefreshSchema } from './ipc-validation.js';
import { getCatalogEntry, searchCatalog } from '../src/core/trainer-catalog/store.js';
import { steamCdnImages, type TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';
import { POPULAR_TRAINER_LIMIT } from '../src/core/trainer-catalog/popular-ranking.js';
import { filterEligibleForTrainerLibrary } from '../src/core/trainer-catalog/eligibility-classification.js';
import type { ArtworkFetchJob, ArtworkKind } from '../src/core/artwork-cache/types.js';
import { fetchArtworkJob } from '../src/core/artwork-cache/fetch-executor.js';
import {
  runArtworkFetchQueue,
  type ArtworkFetchQueueController,
} from '../src/core/artwork-cache/queue.js';
import {
  upsertArtworkCacheEntry,
  listOkArtworkCacheKeys,
  listFailedArtworkCacheEntries,
} from '../src/core/artwork-cache/store.js';

// mirrors requireTrustedSender() in electron/main.ts / electron/live-memory-ipc.ts.
function requireTrustedSender(event: IpcMainInvokeEvent): { ok: true } | { ok: false; reason: string } {
  const result = validateIpcSender(event, ['main']);
  if (!result.ok) return { ok: false, reason: result.reason ?? 'unknown' };
  return { ok: true };
}

function sanitize(error: unknown): string {
  return error instanceof Error ? error.message : 'artwork_cache_error';
}

function artworkCacheDir(): string {
  return path.join(app.getPath('userData'), 'artwork-cache');
}

/** Every artwork URL an entry actually carries (or can derive via steamCdnImages), by kind. */
function candidateUrlsForEntry(entry: TrainerCatalogEntry): Partial<Record<ArtworkKind, string>> {
  const derived = entry.steamAppId ? steamCdnImages(entry.steamAppId) : {};
  return {
    header: entry.headerUrl ?? derived.headerUrl,
    cover: entry.coverUrl ?? derived.coverUrl,
    icon: entry.iconUrl ?? derived.iconUrl,
  };
}

/**
 * ROADMAP §4.5 candidate job set. When the caller (renderer) supplies explicit
 * catalogGameIds — e.g. the cards actually visible on screen — those are used
 * at 'visible' priority. Without an explicit list, this falls back to the
 * same bounded Popular projection the Trainer Library's default view already
 * uses, at 'popular' priority — a real, non-fabricated scope rather than
 * guessing at "installed"/"favorite" signals this process cannot cheaply see.
 */
function buildCandidateJobs(catalogGameIds: string[] | undefined): ArtworkFetchJob[] {
  const hasExplicitIds = Boolean(catalogGameIds && catalogGameIds.length > 0);
  const priority = hasExplicitIds ? 'visible' : 'popular';
  // Explicit ids (cards actually visible on screen) are looked up directly —
  // filtering them out of a capped Popular-projection window (D07 defect
  // class) would silently drop artwork for any visible card whose catalog
  // entry does not fall in the first POPULAR_TRAINER_LIMIT rows. Only the
  // no-explicit-ids fallback intentionally uses the bounded Popular scope.
  const scoped = hasExplicitIds
    ? filterEligibleForTrainerLibrary(
        catalogGameIds!.map((id) => getCatalogEntry(id)).filter((entry): entry is TrainerCatalogEntry => entry != null),
      )
    : searchCatalog('', POPULAR_TRAINER_LIMIT, 0, {}).entries;

  const jobs: ArtworkFetchJob[] = [];
  for (const entry of scoped) {
    const urls = candidateUrlsForEntry(entry);
    for (const kind of ['header', 'cover', 'icon'] as ArtworkKind[]) {
      const sourceUrl = urls[kind];
      // ROADMAP §4.2: every source this function currently knows how to
      // derive artwork from is Steam's CDN — classified 'remote-unverified-
      // rights' and never auto-promoted. The persistent-cache gate
      // (fetch-executor.ts / cache-writer.ts) will correctly refuse to
      // write these; they are still queued so the refusal is recorded as an
      // auditable 'rights-blocked' entry rather than silently dropped.
      if (sourceUrl) jobs.push({ catalogGameId: entry.catalogGameId, kind, sourceUrl, priority, rightsClass: 'remote-unverified-rights' });
    }
  }
  return jobs;
}

function buildRetryJobs(): ArtworkFetchJob[] {
  return listFailedArtworkCacheEntries().map((entry) => ({
    catalogGameId: entry.catalogGameId,
    kind: entry.kind,
    sourceUrl: entry.sourceUrl,
    priority: 'installed',
    rightsClass: entry.rightsClass,
  }));
}

let activeController: ArtworkFetchQueueController | null = null;

function startQueue(jobs: ArtworkFetchJob[], options: { bypassOkDedup: boolean }): { queued: number } {
  const cacheDir = artworkCacheDir();
  const alreadyCachedKeys = options.bypassOkDedup ? new Set<string>() : listOkArtworkCacheKeys();
  activeController = runArtworkFetchQueue(
    jobs,
    async (job) => {
      const result = await fetchArtworkJob(job, { cacheDir });
      upsertArtworkCacheEntry(result);
    },
    { alreadyCachedKeys },
  );
  return { queued: jobs.length };
}

export function registerArtworkCacheIpc(): void {
  ipcMain.handle('artwork-cache-refresh', async (event, payload: unknown) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      if (activeController && !activeController.isCancelled() && (activeController.activeCount() > 0 || activeController.completedCount() < activeController.totalCount())) {
        return { success: false, error: 'already_running' };
      }
      const parsed = ArtworkCacheRefreshSchema.parse(payload ?? {});
      const jobs = buildCandidateJobs(parsed.catalogGameIds);
      const { queued } = startQueue(jobs, { bypassOkDedup: true });
      return { success: true, queued };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('artwork-cache-retry-missing', async (event) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      if (activeController && !activeController.isCancelled() && (activeController.activeCount() > 0 || activeController.completedCount() < activeController.totalCount())) {
        return { success: false, error: 'already_running' };
      }
      const jobs = buildRetryJobs();
      const { queued } = startQueue(jobs, { bypassOkDedup: false });
      return { success: true, queued };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('artwork-cache-status', async (event) => {
    try {
      const senderCheck = requireTrustedSender(event);
      if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
      if (!activeController) {
        return { success: true, running: false, active: 0, completed: 0, total: 0, paused: false, cancelled: false };
      }
      return {
        success: true,
        running: activeController.activeCount() > 0 || activeController.completedCount() < activeController.totalCount(),
        active: activeController.activeCount(),
        completed: activeController.completedCount(),
        total: activeController.totalCount(),
        paused: activeController.isPaused(),
        cancelled: activeController.isCancelled(),
      };
    } catch (error) {
      return { success: false, error: sanitize(error) };
    }
  });

  ipcMain.handle('artwork-cache-pause', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    activeController?.pause();
    return { success: true };
  });

  ipcMain.handle('artwork-cache-resume', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    activeController?.resume();
    return { success: true };
  });

  ipcMain.handle('artwork-cache-cancel', async (event) => {
    const senderCheck = requireTrustedSender(event);
    if (senderCheck.ok === false) return { success: false, error: `sender_rejected:${senderCheck.reason}` };
    activeController?.cancel();
    return { success: true };
  });
}

/** Test/internal-only reset so unit tests don't leak queue state across cases. Never exposed via IPC. */
export function resetArtworkCacheIpcStateForTesting(): void {
  activeController = null;
}

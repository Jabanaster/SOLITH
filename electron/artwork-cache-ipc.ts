import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { validateIpcSender } from './sender-validation.js';
import { ArtworkCacheRefreshSchema } from './ipc-validation.js';
import { searchCatalog } from '../src/core/trainer-catalog/store.js';
import { steamCdnImages, type TrainerCatalogEntry } from '../src/core/trainer-catalog/types.js';
import { POPULAR_TRAINER_LIMIT } from '../src/core/trainer-catalog/popular-ranking.js';
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
import { getSetting } from '../src/core/settings/index.js';
import { isOnlineOperationAllowed } from '../src/core/settings/online-services-gate.js';

/**
 * Master Online Services gate for artwork downloads. All three artwork-cache
 * IPC handlers below call fetchArtworkJob (a real network fetch); none had
 * any online-activity gate before this check, so this blocks every one of
 * them unconditionally when Online Services is off.
 */
function isArtworkDownloadAllowed(): boolean {
  const onlineServicesEnabled = getSetting('onlineServicesEnabled') !== false;
  return isOnlineOperationAllowed({ onlineServicesEnabled }, 'artwork-download');
}
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
  const priority = catalogGameIds && catalogGameIds.length > 0 ? 'visible' : 'popular';
  const result = searchCatalog('', POPULAR_TRAINER_LIMIT, 0, {});
  const scoped = catalogGameIds && catalogGameIds.length > 0
    ? result.entries.filter((entry) => catalogGameIds.includes(entry.catalogGameId))
    : result.entries;

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
      if (!isArtworkDownloadAllowed()) return { success: false, error: 'online_services_disabled' };
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
      if (!isArtworkDownloadAllowed()) return { success: false, error: 'online_services_disabled' };
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

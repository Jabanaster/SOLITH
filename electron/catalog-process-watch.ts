import { BrowserWindow } from 'electron';

let timer: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 15_000;

export interface CatalogProcessDetectionPayload {
  catalogGameId: string;
  displayName: string;
  pid: number;
  executable: string;
  /** Zero-Input plan preview (offline confirm is false at poll time). */
  planAllowed: boolean;
  blockReason?: string;
  fingerprintStatus?: string;
  hasDefinition: boolean;
  prepareReady: boolean;
  executableHashSHA256?: string;
}

export interface CatalogProcessClearedPayload {
  catalogGameId: string;
}

/** catalogGameId -> most recent detection payload for that game, while its process is still running. */
const activeDetections = new Map<string, CatalogProcessDetectionPayload>();

/** Most recent single detection (back-compat for callers reading one game, e.g. trainer-deck-ipc). */
let lastDetection: CatalogProcessDetectionPayload | null = null;

async function buildDetectionPayload(
  mod: typeof import('../src/core/live-memory/index.js'),
  detection: { catalogGameId: string; displayName: string; pid: number; executable: string },
): Promise<CatalogProcessDetectionPayload> {
  const { loadCatalogDefinition } = await import('../src/core/definitions/load-catalog-definition.js');
  const { hashInstalledExecutableForCatalog } = await import(
    '../src/core/live-memory/installed-exe-hash.js'
  );
  const definition = loadCatalogDefinition(detection.catalogGameId);
  const executableHashSHA256 = hashInstalledExecutableForCatalog(
    detection.catalogGameId,
    detection.executable,
  );

  // Poll-time plan never auto-attaches: offline confirm is false until the user opts in.
  const plan = mod.planZeroInputDetection({
    detection,
    definition,
    userConfirmedOffline: false,
    executableHashSHA256,
    remoteConnections: {
      availability: 'available',
      remoteConnectionCount: 0,
      observedAt: new Date().toISOString(),
    },
  });

  return {
    catalogGameId: detection.catalogGameId,
    displayName: detection.displayName,
    pid: detection.pid,
    executable: detection.executable,
    planAllowed: plan.allowed,
    blockReason: plan.blockReason,
    fingerprintStatus: plan.fingerprint.status,
    hasDefinition: definition != null,
    // User must confirm offline + call prepare IPC; watch never attaches.
    prepareReady: definition != null,
    executableHashSHA256: executableHashSHA256 ?? undefined,
  };
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

async function pollCatalogProcesses(): Promise<void> {
  try {
    const mod = await import('../src/core/live-memory/index.js');
    const { listCatalogExecutableIndex } = await import('../src/core/trainer-catalog/store.js');
    const processes = mod.listLiveMemoryProcesses();
    // Full catalog index (not a paged/limited search window) — a game whose
    // catalog entry sorts past any fixed page size must still be detectable.
    const catalogEntries = listCatalogExecutableIndex();

    const detections = mod.matchAllCatalogProcesses(processes, catalogEntries);
    const seenGameIds = new Set(detections.map((d) => d.catalogGameId));

    // Games that were running last poll but no longer have a matching live
    // process (exited, or SOLITH lost track) — clear their state so the
    // renderer's "Running" filter/badge doesn't go stale.
    for (const catalogGameId of activeDetections.keys()) {
      if (seenGameIds.has(catalogGameId)) continue;
      activeDetections.delete(catalogGameId);
      broadcast('catalog-process-cleared', { catalogGameId } satisfies CatalogProcessClearedPayload);
    }

    for (const detection of detections) {
      const previous = activeDetections.get(detection.catalogGameId);
      // Re-detect (build a fresh payload + notify) when this is a newly-seen
      // game OR the pid changed under the same game id (process restarted).
      if (previous && previous.pid === detection.pid) continue;

      const payload = await buildDetectionPayload(mod, detection);
      activeDetections.set(detection.catalogGameId, payload);
      lastDetection = payload;
      broadcast('catalog-process-detected', payload);
    }
  } catch (error) {
    // Best-effort watch — a poll failure must not crash the timer loop, but
    // it must not vanish silently either (a silent catch here previously hid
    // detection breakage entirely).
    console.error('[catalog-process-watch] poll failed:', error);
  }
}

function restartTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  timer = setInterval(() => {
    void pollCatalogProcesses();
  }, currentIntervalMs);
}

/**
 * Polls running processes against bundled catalog executables and notifies
 * renderers when a known game is detected (offline catalog match only).
 * Emits Zero-Input plan preview fields; does not attach or write memory.
 */
export async function startCatalogProcessWatch(intervalMs = 15_000): Promise<void> {
  currentIntervalMs = intervalMs;
  if (timer) return;
  restartTimer();
  await pollCatalogProcesses();
}

export function setCatalogProcessWatchInterval(intervalMs: number): void {
  currentIntervalMs = intervalMs;
  if (!timer) return;
  restartTimer();
}

export function getLastProcessDetection(): typeof lastDetection {
  return lastDetection;
}

/**
 * Current snapshot of every catalog game whose process is live right now.
 * Renderers pull this on mount/reload so a game already running before
 * SOLITH (re)started — or before a given window existed — is not lost until
 * the next poll happens to notice a pid change.
 */
export function getActiveProcessDetections(): CatalogProcessDetectionPayload[] {
  return Array.from(activeDetections.values());
}

export function stopCatalogProcessWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeDetections.clear();
  lastDetection = null;
}

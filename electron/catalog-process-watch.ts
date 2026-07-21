import { BrowserWindow } from 'electron';

let timer: ReturnType<typeof setInterval> | null = null;
let lastNotified = '';
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

let lastDetection: CatalogProcessDetectionPayload | null = null;

async function pollCatalogProcesses(): Promise<void> {
  try {
    const mod = await import('../src/core/live-memory/index.js');
    const { searchCatalog } = await import('../src/core/trainer-catalog/store.js');
    const { loadCatalogDefinition } = await import('../src/core/definitions/load-catalog-definition.js');
    const processes = mod.listLiveMemoryProcesses();
    const catalog = searchCatalog('', 200, 0);

    const catalogEntries = catalog.entries.map((entry) => ({
      catalogGameId: entry.catalogGameId,
      displayName: entry.displayName,
      executables: entry.executables,
    }));

    const detection = mod.matchCatalogProcess(processes, catalogEntries);
    if (!detection) return;

    const definition = loadCatalogDefinition(detection.catalogGameId);
    const { hashInstalledExecutableForCatalog } = await import(
      '../src/core/live-memory/installed-exe-hash.js'
    );
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

    const key = `${detection.catalogGameId}:${detection.pid}`;
    const payload: CatalogProcessDetectionPayload = {
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
    lastDetection = payload;

    if (key === lastNotified) return;
    lastNotified = key;

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('catalog-process-detected', payload);
      }
    }
  } catch {
    // Non-fatal — watch is best-effort
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

export function stopCatalogProcessWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastNotified = '';
  lastDetection = null;
}

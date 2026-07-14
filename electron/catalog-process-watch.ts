import { BrowserWindow } from 'electron';

let timer: ReturnType<typeof setInterval> | null = null;
let lastNotified = '';
let currentIntervalMs = 15_000;
let lastDetection: {
  catalogGameId: string;
  displayName: string;
  pid: number;
  executable: string;
} | null = null;

async function pollCatalogProcesses(): Promise<void> {
  try {
    const mod = await import('../src/core/live-memory/index.js');
    const { searchCatalog } = await import('../src/core/trainer-catalog/store.js');
    const processes = mod.listLiveMemoryProcesses();
    const catalog = searchCatalog('', 200, 0);

    for (const proc of processes) {
      const name = proc.name.toLowerCase();
      const match = catalog.entries.find((entry) =>
        entry.executables.some((exe) => exe.toLowerCase() === name),
      );
      if (!match) continue;

      const key = `${match.catalogGameId}:${proc.pid}`;
      const payload = {
        catalogGameId: match.catalogGameId,
        displayName: match.displayName,
        pid: proc.pid,
        executable: proc.name,
      };
      lastDetection = payload;

      if (key === lastNotified) continue;
      lastNotified = key;

      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('catalog-process-detected', payload);
        }
      }
      break;
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

import { BrowserWindow } from 'electron';

let timer: ReturnType<typeof setInterval> | null = null;
let lastNotified = '';

/**
 * Polls running processes against bundled catalog executables and notifies
 * renderers when a known game is detected (offline catalog match only).
 */
export async function startCatalogProcessWatch(intervalMs = 15_000): Promise<void> {
  if (timer) return;

  timer = setInterval(async () => {
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
        if (key === lastNotified) continue;
        lastNotified = key;

        const payload = {
          catalogGameId: match.catalogGameId,
          displayName: match.displayName,
          pid: proc.pid,
          executable: proc.name,
        };

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
  }, intervalMs);
}

export function stopCatalogProcessWatch(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastNotified = '';
}

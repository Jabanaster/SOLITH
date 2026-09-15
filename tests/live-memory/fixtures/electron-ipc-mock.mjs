// Minimal Electron main-process mock for the Stage 7.1 §7.1-C full IPC-path
// test. Not a general-purpose Electron shim — only the surface
// `electron/live-memory-ipc.ts` (and `electron/avowed-wingdk-backup-watch.ts`,
// which it imports) actually touch at runtime: `ipcMain.handle`, `app.getPath`,
// and `BrowserWindow.getAllWindows`.
//
// Real IPC transport (V8 serialization over a native channel) is not
// reproduced — that plumbing is Electron's own, not Solith's, and is not
// what Stage 7's "no NativeScanTarget shortcut" requirement is about. What
// this DOES give the test: the exact same registered `ipcMain.handle`
// callback the real renderer would invoke, called the same way
// (`event`, `payload`), running the real schema validation, real
// `LiveMemorySession`, real `ScannerBackendRouter`, real native addon, and
// real serialization — nothing stubbed below that layer.

export const __ipcHandlers = new Map();

export const ipcMain = {
  handle(channel, listener) {
    __ipcHandlers.set(channel, listener);
  },
};

export async function __invoke(channel, event, payload) {
  const handler = __ipcHandlers.get(channel);
  if (!handler) throw new Error(`no ipcMain.handle registered for channel: ${channel}`);
  return handler(event, payload);
}

let userDataDir = null;
export function __setUserDataDir(dir) {
  userDataDir = dir;
}

export const app = {
  getPath(name) {
    if (name === 'userData') {
      if (!userDataDir) throw new Error('__setUserDataDir must be called before app.getPath("userData")');
      return userDataDir;
    }
    throw new Error(`electron-ipc-mock: unhandled app.getPath("${name}")`);
  },
  getName: () => 'solith-test',
  on: () => {},
  whenReady: () => Promise.resolve(),
};

export const BrowserWindow = {
  getAllWindows: () => [],
};

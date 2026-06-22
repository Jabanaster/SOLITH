const { contextBridge, ipcRenderer } = require('electron');

// Expose typed API to renderer process
contextBridge.exposeInWorldApi({
  // App paths (read-only)
  appPaths: {
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  },

  // Bundled file reading (restricted)
  readBundledFile: (filePath: string) => {
    return ipcRenderer.invoke('read-bundled-file', filePath);
  },

  // Blocked operations (for security)
  shellOpenPath: () => {
    throw new Error('Shell access is disabled for security reasons');
  },
  childProcess: () => {
    throw new Error('Child process execution is disabled for security reasons');
  },
});

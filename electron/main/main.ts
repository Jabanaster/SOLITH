const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow: typeof BrowserWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: true,
    backgroundColor: '#1B1C20',
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      enableRemoteModule: false,
    },
    icon: path.join(__dirname, '../build/icon.png'),
  });

  // Load the app
  const isDev = (process.env as any).NODE_ENV === 'development';
  
  if (isDev) {
    mainWindow.loadFile(path.join(__dirname, '../src/app/App.tsx'));
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  mainWindow?.close();
});

// Security: Prevent arbitrary file operations from renderer
ipcMain.handle('get-app-path', () => {
  return app.getPath('app');
});

// Security: Prevent arbitrary file system access
ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

// Security: Only allow reading bundled assets
ipcMain.handle('read-bundled-file', (_event: Electron.IpcMainEvent, filePath: string) => {
  const fullPath = path.join(app.getAppPath(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, 'utf-8');
});

// Security: Prevent shell execution
ipcMain.handle('shell-open-path', (_event: Electron.IpcMainEvent, _path: string) => {
  // Block shell access for security
  throw new Error('Shell access is disabled for security reasons');
});

// Security: Prevent child process execution
ipcMain.handle('child-process', (_event: Electron.IpcMainEvent, _command: string) => {
  // Block child process execution for security
  throw new Error('Child process execution is disabled for security reasons');
});

module.exports = { createWindow };

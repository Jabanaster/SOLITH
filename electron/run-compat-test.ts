import { app } from 'electron';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);

app.whenReady().then(async () => {
  try {
    // Import compiled sibling JS compatibility test
    await import('./compat-test-main.js');
    app.quit();
  } catch (error) {
    console.error('Test failed:', error);
    app.quit();
    process.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

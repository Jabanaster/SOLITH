import { createTsupConfig } from './electron/tsup-shared-config.js';

export default createTsupConfig({ mode: 'test', outDir: 'dist-electron-test' });

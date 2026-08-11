import { createTsupConfig } from './electron/tsup-shared-config.js';

export default createTsupConfig({ mode: 'production', outDir: 'dist-electron' });

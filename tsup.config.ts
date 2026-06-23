import { defineConfig } from 'tsup';

export default defineConfig([
  // Main process bundle
  {
    entry: { main: 'electron/main.ts' },
    outDir: 'dist-electron',
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: false,          // Vite owns dist-electron/dist — don't wipe it
    dts: false,
    bundle: true,
    // Bundle all src/core/* into the main bundle — no bare relative imports at runtime
    // Only keep electron + node built-ins + heavy native deps as external
    external: [
      'electron',
      'better-sqlite3',
    ],
    noExternal: [
      /^\.\.?\//,  // Bundle all relative imports
    ],
    esbuildOptions(options) {
      // Inject __dirname / __filename shims for any legacy code
      options.define = {
        ...options.define,
      };
    },
    banner: {
      // Ensure ESM interop for dynamic requires that some deps use.
      // NOTE: We use _pathDirname as the local alias to avoid conflicts when
      // the bundled source also imports { dirname } from 'path' directly.
      js: `
import { createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _pathDirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _pathDirname(__filename);
`.trim(),
    },
  },
  // Preload process bundle — MUST be CJS for Electron sandbox compatibility.
  // Electron's sandboxed preload loader requires CommonJS format when
  // sandbox: true is set. ESM preloads do not reliably expose contextBridge.
  {
    entry: { preload: 'electron/preload.ts' },
    outDir: 'dist-electron',
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    splitting: false,
    sourcemap: true,
    clean: false,
    dts: false,
    bundle: true,
    external: ['electron'],
  },
]);

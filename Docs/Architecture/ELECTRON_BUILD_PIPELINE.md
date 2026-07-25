# Electron Build Pipeline

## Summary

Solith uses **tsup** to bundle Electron main and preload processes. This replaced the original `tsc + fix-esm-imports` approach.

## Why tsup was chosen

The original approach used `tsc` (TypeScript compiler) followed by a custom ESM import fixer (`fix-esm-imports.mjs`). Problems:

1. `tsc` with `moduleResolution: Bundler` emits TypeScript-style bare imports (`from '../database'`) that Node.js ESM cannot resolve without explicit `.js` extensions.
2. The post-build fixer had to detect whether each import resolved to a directory (`index.js`) or a file (`module.js`), requiring filesystem inspection at build time.
3. This added fragility: any file rename could silently break resolution at runtime.

**tsup** (which wraps esbuild) bundles all relative imports into a single output file. There are no bare relative imports at runtime — everything is inlined.

## Current Setup

### Entries
- `electron/main.ts` → `dist-electron/main.js` (ESM)
- `electron/preload.ts` → `dist-electron/preload.cjs` (CommonJS — required for Electron `sandbox` / contextIsolation preload)

Electron `BrowserWindow` preload path must resolve to **`preload.cjs`**, not `preload.js`.

### Externals
- `electron` — provided by the Electron runtime

Shipped persistence uses **sql.js** (WASM), which is bundled/unpacked as configured in `package.json` `asarUnpack`. There is no `better-sqlite3` dependency.

### Banner
A shim is prepended to `main.js` to provide `__dirname`, `__filename`, and `require` for any legacy code in dependencies that expects CommonJS globals:

```js
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### Output verification
`scripts/verify-electron-output.mjs` runs automatically after every `build:electron` invocation. It checks:
- Both output files exist (`main.js`, `preload.cjs`)
- No `.ts` imports in output
- No bare relative imports
- No test runner used as main
- `contextBridge` and `exposeInMainWorld` present in preload (`preload.cjs`)
- `nodeIntegration: false` and `contextIsolation: true` in main
- Single-instance lock present
- Bundle size sanity (main > 10 KB, < 5 MB; preload > 100 bytes, < 100 KB)

## Build Scripts

| Script | What it does |
|--------|-------------|
| `build:electron` | `tsup` → then `verify-electron-output.mjs` |
| `build:vite` | Vite production build of renderer |
| `build` | `build:vite` + `build:electron` + `electron-builder` |
| `verify:electron-output` | Run verifier standalone |

## Status of fix-esm-imports

`fix-esm-imports.mjs` and `fix-esm-imports.ps1` remain in the repository root for historical reference but are **not referenced by any script**. They can be deleted once the previous session's notes have been archived.

# Phase 1 / Stage 7 — Packaged Electron Integration

## §7.17 — status: partial, with one real bug found and fixed

### What was proven

- **`.node` packaged, correct architecture**: `native/solith-scanner-napi/solith-scanner-napi.win32-x64-msvc.node` (x86_64-pc-windows-msvc) is copied into the packaged app via `electron-builder`'s `extraResources` (`native/solith-scanner-napi` → `resources/native/solith-scanner-napi`, filtered to `index.js`, `index.d.ts`, `package.json`, `*.node` only).
- **Correct loading path / N-API ABI / dependency resolution**: the packaged copy loads and runs standalone — `require(<packaged path>/index.js).NativeScanTarget` is a function and `debugEchoU64(123n) === 123n`, proven directly against the built `dist/win-unpacked/resources/native/solith-scanner-napi/index.js` after a real `npm run build` (full `vite build` + `build:electron` + `electron-builder`).
- **Electron dev**: `NativeScannerBackend`'s primary load path (`require('solith-scanner-napi')`, resolved via the real `node_modules/solith-scanner-napi` symlink created by this stage's `file:native/solith-scanner-napi` dependency) is the same path exercised by every real-process test this stage — proven working under plain Node (tsx) and, by the same module-resolution mechanism, under Electron dev.
- **Packaged app launches without crashing**: `dist/win-unpacked/Solith.exe` was launched directly (not installed — the unpacked, already-signed app binary electron-builder produces before building the NSIS installer) and ran cleanly for several seconds with normal startup log output (community-sync tick, hotkey registration, etc.), then was terminated as part of this verification. No native-module load error appeared in its log.
- **Error diagnostics if load fails**: `NativeScannerBackend`'s loader never throws a raw/uncaught error — `native_addon_missing` (neither node_modules nor packaged-resources copy found) and `native_addon_load_failed` (packaged-resources copy found but failed to `require`) are both distinct, typed `ScannerBackendError`s with the underlying error text preserved.

### A real bug found and fixed this stage

The first packaging attempt used `asarUnpack: ["node_modules/solith-scanner-napi/**"]` to make the `file:`-linked addon dlopen-able from inside the asar archive. Because `npm install` creates `node_modules/solith-scanner-napi` as a real symlink to `native/solith-scanner-napi`, electron-builder followed the symlink and packaged the addon crate's ENTIRE directory tree — including `target/release/build/**` and `target/debug/**` Rust build-script binaries (dozens of unrelated `.exe` files, code-signed one by one). This produced a 666 MB `app.asar.unpacked/node_modules/solith-scanner-napi` directory and a 316 MB installer, roughly double the expected size.

**Fix**: excluded `node_modules/solith-scanner-napi/**` from `files` entirely (`"!node_modules/solith-scanner-napi/**"`) and removed the now-unnecessary `asarUnpack` entry for it. The packaged app now relies exclusively on the filtered `extraResources` copy (a few hundred KB, index.js/index.d.ts/package.json/the compiled `.node` only) — which is also exactly the fallback path `NativeScannerBackend`'s loader already used, since a packaged app's `require('solith-scanner-napi')` now correctly fails (the package is genuinely absent from the packaged `node_modules`) and falls through to `process.resourcesPath`. Re-verified: installer size dropped from 316 MB to 165 MB, `node_modules/solith-scanner-napi` is absent from the packaged app, and the `resources/native/solith-scanner-napi` copy loads correctly. This is documented as a real, caught-before-shipping defect in this stage's own packaging design, not a defect in Stage 1-6's native code.

### Not done this stage

- No clean/fresh-machine installation test (the NSIS installer itself was built but not run/installed — running an installer is a real, consequential system change and was not performed without separate explicit authorization).
- No in-app GUI walkthrough of the packaged build attaching to a real process and clicking "scan."

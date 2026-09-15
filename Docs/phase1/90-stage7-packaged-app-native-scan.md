# Phase 1 / Stage 7.1 — Packaged Application Native Scan

## §7.1-F — beyond "standalone require()"

Doc 78 (Stage 7) proved the packaged addon `require()`s successfully and exposes `NativeScanTarget` as a function. Mission §7.1-F explicitly calls that insufficient. This pass rebuilt the packaged app fresh against Stage 7.1's source changes (int64 wire fix included) and proved a **real scan operation**, not just a constructor check, through the packaged addon copy.

## Fresh packaged build

- `npm run build:electron`: 33/33 verifier checks pass, including confirming `targetValueBigint` (this stage's int64 fix) is present in the rebuilt `dist-electron/main.js` bundle — the packaged code is not stale.
- `npx electron-builder --dir --win`: real directory-mode packaging (native `@electron/rebuild` for `memoryjs`, real Authenticode signing of `Solith.exe` and the bundled read-only-scanner helper, real asar). Output: `dist/win-unpacked/Solith.exe` (232 MB) + `dist/win-unpacked/resources/native/solith-scanner-napi/` (addon `.node` refreshed, 900 KB).

## Real scan through the packaged path

A standalone script (`packaged-native-scan-proof.mjs`) loaded the addon by its **exact packaged absolute path** (`dist/win-unpacked/resources/native/solith-scanner-napi/index.js`) — not via `require('solith-scanner-napi')`, so `node_modules` resolution is not involved at all, matching what `NativeScannerBackend`'s `process.resourcesPath` fallback actually does in a packaged app. Against the real spawned `solith-scanner-fixture.exe`:

- `NativeScanTarget.attach(pid)` — real attach, real PID.
- `enumerateRegions()` — 136 real regions from the real process.
- `scanExact(region, 'u32', <sentinel>, ..., 'bytewise', 65536n, 7n, undefined, ScanCancellationHandle, ScanProgressHandle)` — a **real scan call**, the same shape `NativeScannerBackend.exactScan` makes internally.
- Result: sentinel found at its real address, `completeness.state: 'complete'`, `regionsRead: 1`, `bytesRead: 4194752` — a genuine, real, non-trivial scan result, not a stub.

This closes the specific objection in mission §7.1-F ("a standalone require() of the copied .node file is not sufficient") — a real scan operation now runs successfully from the packaged resource path.

## What remains open

**Not done**: a live, in-app GUI click-through (launch `Solith.exe`, navigate the renderer's live-memory trainer UI, attach to a process via the real process picker, click Scan, see results rendered) was not performed this pass. That requires interactive GUI automation across an unlock/attach/scan flow this pass did not attempt, given the size of the rest of Stage 7.1's required work. The proof above closes the gap between "the addon loads" and "the addon actually scans from its packaged location" — it does not close the gap between "the addon scans" and "a real user, through the real UI, sees a real result." Mission §7.1-S's "packaged app real native scan proven" gate item is evaluated as **PARTIAL** in doc 96 for this reason: the native-scan half is now real evidence, the UI-click-through half remains undone.

Full `electron-builder` installer/NSIS packaging (the 165 MB installer artifact) was not rebuilt this pass — only `--dir` mode (unpacked output), sufficient for this proof and consistent with Stage 7's own doc 86 precedent of skipping the installer step when directory-mode output already answers the question at hand.

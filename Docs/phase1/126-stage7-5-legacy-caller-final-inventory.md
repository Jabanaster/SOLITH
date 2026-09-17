# Phase 1 / Stage 7.5 §10 — Legacy Caller Final Inventory

Repo-wide re-inventory of every reference to `memory-scanner.ts`, `native-memory-driver.ts`, `aob-resolver.ts`, `signature-engine.ts`, `feature-resolver.ts`, `live-memory-session.ts`, `hook-engine.ts`, and the scanner backend/router. Searched: `src/`, `electron/`, `tests/`, `scripts/`. Excluded: `node_modules`, `dist*`, `target/`.

`src/core/live-memory/index.ts` is a barrel; it is loaded at runtime in exactly two places, both main-process dynamic imports (`electron/live-memory-ipc.ts:93`, `electron/catalog-process-watch.ts:25`). No renderer file imports any legacy scanner module — the renderer reaches all of it over IPC, a boundary `src/core/cheat-system/game-detector.ts:5` documents explicitly.

## AOB / signature paths — the mission §10 target

| Call site | Symbol | Classification |
|---|---|---|
| `process-watcher.ts:220` → `resolveSignatureWithCoverage` | exact + fuzzy | `MIGRATED_TO_BACKEND` — both resolvers bound by `zero-input-prepare.ts:191` |
| `signature-engine.ts` `scanExactSignature` (direct `MemoryDriver`) | exact | `COMPATIBILITY_SHIM` — reached only when `exactAobResolver` is unbound; production always binds |
| `signature-engine.ts` `scanFuzzySignature` (direct `MemoryDriver`) | fuzzy | `COMPATIBILITY_SHIM` — reached only when `fuzzyAobResolver` is unbound; production always binds |
| `feature-resolver.ts:~118` `scanAobInProcess` | AOB | `COMPATIBILITY_SHIM` — same, unbound-resolver fallback only |
| `scanner-backend-legacy.ts:185` `scanAobInProcess` | AOB | `LEGACY_ROLLBACK_ONLY` — the controlled routing arm, not counted as unmigrated per mission §5 |
| `scanner-backend-legacy.ts:125` `scanFirst` | exact value | `LEGACY_ROLLBACK_ONLY` — same |
| `electron/live-memory-ipc.ts:1358` `scanAobViaBackend` (hook install) | AOB | `MIGRATED_TO_BACKEND` |
| `hook-engine.ts:56` `driver.readBuffer(handle, hookSite, patchSize)` | byte snapshot | **not a scan** — a fixed-size read at an already-resolved address on the write path, taken so the original bytes can be restored on rollback. The AOB resolution that produces `hookSite` is backend-routed. Routed through the caller/backend seam, per mission §5's own allowance |
| `tests/**`, `scripts/explore-*`, `scripts/certify-live-pointer.mjs` | various | `TEST_ONLY` / dev tooling, not shipped |

**NORMAL PRODUCTION DIRECT LEGACY AOB CALLERS: 0.**

Stage 7.4 (doc 119) reported this as **1**, naming the fuzzy sub-path as "the one honest exception". That exception is closed.

## Value-scan paths still on legacy — by design, unchanged this stage

These were scoped out of the AOB count at Stage 7.4 and remain so. They are recorded here so nothing is unaccounted, not because this stage changed them.

| IPC handler | Session method | Classification |
|---|---|---|
| `live-memory-scan-first` (`:503`) | `scanExactViaBackend` | `MIGRATED_TO_BACKEND` |
| `live-memory-scan-first-auto-matrix` (`:539`) | `scanFirstAutoMatrix` | `DELETE_STAGE8` — multi-mode/multi-type range fan-out; the routed contract has no range/comparison operation yet |
| `live-memory-scan-next` (`:570`) | `scanNext` | `DELETE_STAGE8` — comparison next-scan, legacy-only per `scanner-backend.ts`'s stated migration boundary |
| `live-memory-scan-first-unknown` (`:585`) | `scanFirstUnknown` | `DELETE_STAGE8` — unknown-initial-value scan |
| `live-memory-scan-next-unknown` (`:606`) | `scanNextFromUnknown` | `DELETE_STAGE8` |
| `live-memory-start-exact-scan` (`:1070`) | `startExactScanOperation` | `MIGRATED_TO_BACKEND` |

Being explicit about what this means: the single exact-value primitive scan path **is** routed, but `scanFirstAutoMatrix` fans out across modes *and* data types and can therefore still perform exact-value comparisons on the legacy engine. That is a real, currently-true statement about the shipping product. It is not new, it is not an AOB path, and mission §10's "0" requirement is scoped to primitive/AOB scan paths served by the routed contract — which the auto-matrix's range/comparison modes are not, because the contract does not yet define them. Forward-assigned to Stage 8 (doc 133).

## Pointer paths — explicitly allowed to remain

| Call site | Classification |
|---|---|
| `pointer-scanner.ts` (`getModules`, `getRegions`, `readBuffer`) | `POINTER_SPECIFIC` |
| `pointer-resolver.ts:26` (`getModules`) | `POINTER_SPECIFIC` |
| `feature-resolver.ts` `applyPointerChain` / `resolveViaPointerPath` (`readPointer`) | `POINTER_SPECIFIC` |
| `process-watcher.ts` `applyPointerChain` (`readPointer`) | `POINTER_SPECIFIC` |

Mission §10: *"Pointer-specific code may remain."* D05 (pointer depth) stays `PRODUCT_DEFECT_NOT_YET_CLOSED` and is not touched by this stage.

## Point reads — not scans, not in the migration target

| Call site | What it does | Classification |
|---|---|---|
| `real-time-scanner.ts:76` | `driver.readMemory` of an already-resolved candidate address, polling | `DELETE_STAGE8` — single-address typed read, no scan, no region enumeration |
| `live-correlation-watcher.ts:126` | same shape | `DELETE_STAGE8` |
| `research/memory-viewer.ts:115`, `research/hex-inspector.ts:45` | `driver.readBuffer` at a user-specified address for a hex view | `DELETE_STAGE8` |
| `runtime/windows-readonly-process-module-reader.ts:53-57` | `getModules` / `readBuffer` for the read-only runtime reader | `DELETE_STAGE8` |

None of these enumerate regions or perform pattern/value search, so none is a primitive or AOB scan path. All are named rather than left implicit.

## Module enumeration — a real gap found this stage

`driver.getModules` is the one legacy dependency the fuzzy migration could not remove, because the native scanner core has no module enumeration at all. `LiveMemorySession` injects the OS module list into `NativeScannerBackend` so both backends see the same modules and module-scoped resolution stays fail-closed and identical across them.

The Stage 7.5 canary found that this seam genuinely fails against some real processes: Godlike Burger produced `getModules(28900) failed: method failed to retrieve the first module` on one run. This is a **pre-existing legacy limitation, not a regression** — the legacy fuzzy path called the very same `driver.getModules` for any module-scoped signature and failed identically. It is exactly what native module enumeration would fix. Forward-assigned to Stage 8 (doc 133).

## Required counts

| Metric | Value |
|---|---|
| UNKNOWN | **0** |
| NORMAL PRODUCTION DIRECT LEGACY AOB CALLERS | **0** |
| STILL_PRODUCTION_REQUIRED_DIRECT_LEGACY (primitive/AOB scan paths served by the routed contract) | **0** |
| Legacy retained under `LEGACY_ROLLBACK_ONLY` | 2 (the backend's own exact + AOB arms) |
| `POINTER_SPECIFIC` retained | 4 call sites |
| `DELETE_STAGE8` | 10 call sites, each named above |

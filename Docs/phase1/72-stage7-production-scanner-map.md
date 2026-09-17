# Phase 1 / Stage 7 — Production Scanner Map

## §7.1 — entry gate

Verified in the isolated implementation worktree (`G:\ACTIVE_PROJECTS\solith-phase0-convergence`), never in the preserved shipping worktree (`G:\ACTIVE_PROJECTS\SOLITH`, read-only):

- Branch: `feature/solith-phase1-scanner-reconstruction`.
- Starting HEAD: `23dc5551bbc22f3fd1f47ef9a1081ebca738bbbe` (local == remote, worktree clean).
- Baseline reconfirmed before any edit: Rust 185/185 (1 documented ignore), `cargo fmt --check`/`cargo clippy -- -D warnings` clean; napi 52/52 with `--expose-gc`; full JS/TS 1781/1781 + 10/10; `npm audit` 0; renderer typecheck PASS; electron typecheck PASS; `vite build` PASS; `electron build` (29/29 output checks) PASS.
- Shipping worktree (`G:\ACTIVE_PROJECTS\SOLITH`) state recorded, not touched: branch `preserve/review-gate2-5-working-tree-2026-09-12`, 4 pre-existing untracked build-artifact files (`main.js`, `preload.cjs`, `scripts-out-trainer-library.json`, `scripts-out-visual.json`) inspected read-only only.

## §7.2 — complete shipping scan call graph

Produced by a dedicated read-only trace (13-point checklist) of the isolated worktree's `src/app`, `electron/`, and `src/core/live-memory/` — every citation below is file:line-verified, not inferred.

### Flow diagram

```
UI (src/app/hooks/useGameCheatSession.ts, LiveMemoryTrainerPage.tsx, ExternalTrainerResearchLab.tsx)
  -> window.electronAPI.liveMemory* (electron/preload.ts, 1:1 ipcRenderer.invoke passthrough)
  -> ipcMain.handle('live-memory-scan-*', ...) (electron/live-memory-ipc.ts)
  -> LiveMemorySession (src/core/live-memory/live-memory-session.ts) — the ONE place that already
     knows how to invoke every scan variant
  -> legacy scan delegates: memory-scanner.ts (scanFirst/scanFirstAutoMatrix/scanNext/
     scanFirstUnknown/scanNextFromSnapshotMultiType), aob-resolver.ts (scanAobInProcess),
     pointer-scanner.ts (scanForPointerPath) — OR, as of this stage, the Stage 7 backend
     contract (scanner-backend*.ts) for the two routed operations (exact scan, AOB scan)
  -> native-memory-driver.ts (MemoryDriver — memoryjs) for the legacy path, OR
     native/solith-scanner-napi (NativeScanTarget) for the native path
  -> result serialization (electron/live-memory-ipc.ts's serialize* helpers — the only
     normalization layer; no separate adapter module exists)
  -> renderer
```

### Renderer entry points

`src/app/hooks/useGameCheatSession.ts` (`discover`→`liveMemoryScanFirstAutoMatrix`, `narrow*`→`liveMemoryScanNext`, `discoverUnknown`→`liveMemoryScanFirstUnknown`, `narrowUnknown`→`liveMemoryScanNextFromUnknown`), `src/app/pages/LiveMemoryTrainerPage.tsx` (`handleScanFirst`/`handleScanNext`/`handlePointerScan`), `src/app/pages/ExternalTrainerResearchLab.tsx` (`captureBaseline`/`scanForChanges`/`scanSelectedScriptAob`).

### Preload bridge (`electron/preload.ts`)

Every `liveMemory*` scan method is a bare `ipcRenderer.invoke` passthrough — no transformation logic in preload. Stage 7 adds `liveMemoryScannerRoutingModeGet`/`Set` (additive, §7.5).

### IPC layer (`electron/live-memory-ipc.ts`, ~1870 lines, the only file touching live-memory IPC)

Full channel table recorded in the underlying trace transcript; the two channels Stage 7 routes are `live-memory-scan-first` (exact-value scan) and `live-memory-scan-aob` (AOB scan) — both now call `LiveMemorySession.scanExactViaBackend`/`scanAobViaBackend` instead of `scanFirst`/`scanAobSignature` directly, with the exact same request schema and a backward-compatible, additively-extended response shape (`backend`, `isAuthoritativeAbsence`, and — int64 only — `valueBigint`).

### `LiveMemorySession` (`src/core/live-memory/live-memory-session.ts`)

Confirmed the correct integration seam: its constructor already takes the swappable `MemoryDriver`, and it is the one place that imports every scan delegate (`memory-scanner.ts`, `aob-resolver.ts`, `pointer-scanner.ts`, `feature-resolver.ts`). `aob-resolver.ts` and `signature-engine.ts` bypass `memory-scanner.ts` entirely and call `MemoryDriver` methods directly — so a contract drawn only around `memory-scanner.ts`'s exports would have missed them; the Stage 7 contract is instead drawn at `LiveMemorySession`'s own level (§7.3).

### `memory-scanner.ts`, `native-memory-driver.ts`, `aob-resolver.ts`, `signature-engine.ts`, `feature-resolver.ts`, pointer scanning

Fully re-verified per the doc 71 citations (still accurate, unchanged since Audit 2's `317baf0e` baseline): `native-memory-driver.ts:361`'s 1,048,576-byte `readBuffer` cap; `memory-scanner.ts`'s `valueSize(dataType)`-stepped scan with zero bytewise mode; `memory-scanner.ts`'s `catch { continue; }` on a `readBuffer` throw, which — newly confirmed this stage by `scanner-backend-legacy.test.ts`'s real assertion — never sets `truncated` for that specific skip cause (only for `maxTotalBytes`/`maxMatches` limits); `aob-resolver.ts`/`signature-engine.ts` calling `driver.readBuffer` directly, with `signature-engine.ts` NOT covered by this stage's AOB routing (see doc 83).

### "hook-engine"

Exists at `src/core/in-process-script/hook-engine.ts` — a code-injection/hooking subsystem, unrelated to the scan pipeline. It DOES call `aob-resolver.ts`'s `scanAobInProcess` directly (a real caller this stage's original trace under-scoped — see doc 83) for its own hook-target address resolution, under a separate authority/safety model. Not migrated this stage; explicitly out of scope (a different subsystem, not a "collateral" scanner change).

### Fake/mock paths and shipping test coverage

`tests/fixtures/fake-memory-driver.ts`'s `FakeMemoryDriver` is the sole test double, substituted for `nativeMemoryDriver` across ~19 test files. Shipping-behavior test coverage confirmed present for `memory-scanner.ts`, `aob-resolver.ts`, `feature-resolver.ts`, `signature-engine.ts`, `pointer-scanner.ts`, `live-memory-session.ts`; no IPC-schema-level test exists for the scan channels specifically (still true after this stage — Stage 7's new tests exercise the core/module level, same convention as every prior stage).

### Native addon references before this stage

Confirmed zero references to `solith-scanner-napi`/`solith-scanner-core` anywhere in `electron/`, `src/core/live-memory/`, or `src/app/` before this stage's changes — genuinely not wired into production before Stage 7.

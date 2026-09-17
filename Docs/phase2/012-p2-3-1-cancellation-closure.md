# Phase 2 P2-3.1 — Real Pointer-Map Scan Cancellation

Doc 006 §6 (P2-3) recorded a deliberate scope decision: no Cancel button, because `scanTargetsIntoMap`/`scanForPointerPath` ran fully synchronously inside one `ipcMain.handle` call, with no in-flight window an IPC message could observe or interrupt. That was accurate for the code as it stood then. P2-3.1 §5/§6 requires closing this gap with a *real* cancellable operation, not a cosmetic button — this document is that closure.

## Why the previous architecture genuinely could not be cancelled

Node.js/Electron's main process is single-threaded. `scanTargetsIntoMap` looped over targets calling the fully synchronous `scanForPointerPath`, which looped over BFS frontier items calling synchronous native FFI reads. Nothing in that call chain ever returned control to the event loop, so an incoming `cancel` IPC message could not even be *received*, let alone acted on, until the entire scan had already finished. Wrapping that in an operation-id/poll/cancel API without changing the underlying execution model would have been exactly the "hidden developer API as the user workflow" anti-pattern the original P2-3 mission text warned against, just wearing cancellation's clothing.

## What actually changed

`pointer-scanner.ts`'s BFS was refactored into a synchronous generator (`pointerScanGenerator`, see doc 011) yielding once per frontier item. Two drivers consume it:

- `scanForPointerPath` — drains it in one tight loop, no event-loop yield. Byte-for-byte the same synchronous behavior every existing caller depends on.
- `scanForPointerPathCancellable` — awaits a real `setImmediate` between `.next()` calls. That yield is what lets a concurrently-arriving IPC message actually run inside the same process and flip an `AbortController`'s signal, which the generator's own pre-existing `signal?.aborted` checks (already present, already tested via a pre-aborted signal in `pointer-map-orchestration.test.ts`) then observe on the very next resumption.

`pointer-map-orchestration.ts` gained `scanTargetsIntoMapCancellable`, an async twin of `scanTargetsIntoMap` that awaits the cancellable scanner per target — real interruption both *between* targets (checked before each target starts) and *during* a target's own BFS (the generator's yields).

`LiveMemorySession` gained `startPointerMapScanOperation`/`cancelPointerMapScanOperation`/`getPointerMapScanOperationStatus` — reusing the **exact same operation registry** (`scanOperations: Map<string, ScanOperationEntry>`) the byte-value scanner's `startExactScanOperation`/`cancelScanOperation`/`getScanOperationStatus` already use, not a parallel subsystem. `ScanOperationEntry.kind` gained a `'pointerMap'` variant; cancel/poll are direct delegations to the shared generic methods.

IPC (`pointer-map-scan-start`/`-cancel`/`-poll`), preload (`pointerMapScanStart`/`Cancel`/`Poll`), and `src/types/global.d.ts` mirror `live-memory-scan-first-start`/`-cancel`/`-poll`'s shape exactly, reusing the already-existing `PointerMapScanTargetsSchema` and `LiveMemoryScanOperationIdSchema` validators and the already-existing `serializePointerMapScanResult` serializer.

## UI

`PointerMapPanel`'s "Scan Into Map" now calls `pointerMapScanStart`, then polls `pointerMapScanPoll` every 200ms to a terminal state, instead of a single blocking `pointerMapScanTargets` call. A real "Scanning…" active-state indicator and a real "Cancel Scan" button (enabled only while `scanActive`, and idempotent/safe to click more than once) are wired to it. Unmounting the panel while a scan is in flight cancels the operation via a `useEffect` cleanup rather than leaving it to run unobserved.

## Test-only fixture change, to make cancellation observable at all

Against the real fixture's existing small memory footprint, a real scan (now that discovery is deterministic — doc 011) completes in tens of milliseconds, too fast for a human or Playwright click to reliably land mid-scan. `fixture.rs` gained an optional second CLI arg: a count of small (`64 KiB`) separately-`VirtualAlloc`'d "noise" regions, each real, committed, and readable. Planting ~150 of them slows a real scan to a genuinely observable multi-second duration — the same shape a real game process with many small individual heap allocations naturally has — without any timing hack in the product code under test. This binary is never packaged; it exists solely under `cargo test`/the e2e test harness.

## Cancellation test matrix (mission §7)

`tests/live-memory/pointer-map-scan-cancellation.test.ts`, 10 tests, all passing:

| Case | Result |
|---|---|
| Cancel before first target completes | Both targets recorded `cancelled`, zero nodes |
| Cancel between target A and target B | A keeps its real nodes; B cancelled with zero |
| Cancel during target B | B stops mid-scan with real progress (`deepestLevelCompleted > 0`) recorded, reports `cancelled` truthfully |
| Cancel after completion | Safe no-op — result identical to an uninterrupted run |
| Double cancel | Idempotent, both calls return `found: true`, never throws |
| Cancel unknown operation id | `found: false`, never throws |
| Process exits during cancel | Reports a real terminal state (`cancelled` or `process_exited`), never corrupts or crashes |
| Resource limit vs cancel | Cancel (requested before the call starts) wins outright over a tight `maxTotalScans` cap |
| Start new scan after cancel | Second operation reaches its own real terminal state |
| Cancellable vs synchronous parity | Identical result shape when never actually cancelled |

Cancellation timing in the "between"/"during" cases is landed **deterministically**, not raced against a wall-clock timer: a `signal.aborted` getter that flips to `true` starting from the Nth *read* (N measured empirically per fixture via a probe script, not guessed), matching this project's own "prefer deterministic synchronization" guidance over retry-until-green.

## Real-UI, real-process proof (mission §8)

`tests/pointer-map-ui-cancellation.e2e.test.ts` (dev build) and its packaged twin drive the actual rendered Cancel button against a real spawned, noise-slowed fixture through Electron/Playwright: start a scan, see the UI visibly enter the active-scanning state with Cancel enabled, click Cancel while the backend operation is genuinely still running, observe the UI settle on a truthful cancelled outcome (never a silent stuck "Scanning…" and never a silently-successful result), confirm Cancel returns to disabled, and confirm a fresh scan started immediately afterward reaches its own real terminal state.

Results: dev build 4/4 clean (one debug run plus a 3-run stability check); packaged build 3/3 clean.

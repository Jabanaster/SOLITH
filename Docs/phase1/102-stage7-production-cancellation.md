# Phase 1 / Stage 7.2/7.3 — Production Scan Cancellation

## §2/§3/§9/§12 — the real gap closed this pass

Before this pass, cancellation existed but stopped at `ScannerBackend`/`NativeScannerBackend`: `exactScan`/`aobScan` accepted an optional `ScanControl { signal: AbortSignal }` and `NativeScannerBackend.wireCancellation` wired it to a real `ScanCancellationHandle`, but nothing above that layer ever constructed an `AbortController` or forwarded one. `LiveMemorySession.scanExactViaBackend`/`scanAobViaBackend` had no cancellation parameter at all, and no IPC channel referenced an in-flight operation by ID. There was also no concept of an "operation ID" anywhere in the codebase (`grep` for `operationId`/`scanId` across `src/core/live-memory/*.ts` and `electron/*.ts` returned zero hits before this pass).

## What was built

- `LiveMemorySession` (`src/core/live-memory/live-memory-session.ts`): a `scanOperations: Map<string, ScanOperationEntry>` registry. `startExactScanOperation`/`startAobScanOperation` generate a real `randomUUID()`, create a real `AbortController`, register it, and return the `operationId` **synchronously, before the scan has done any work** — the async scan itself runs in the background. `cancelScanOperation(operationId)` calls `controller.abort()` (idempotent — a duplicate call or a call after the operation is already terminal is always safe, never throws) and reports `found`/`alreadyTerminal`. `getScanOperationStatus(operationId)` polls current state (`pending`/`complete`/`cancelled`/`error`). `detach()` aborts and clears every pending entry.
- `electron/live-memory-ipc.ts`: 4 new channels — `live-memory-scan-first-start`, `live-memory-scan-aob-start`, `live-memory-scan-cancel`, `live-memory-scan-poll` — reusing the existing `LiveMemoryScanFirstStartSchema`/`LiveMemoryScanAobStartSchema`/`LiveMemoryScanOperationIdSchema` validation added to `electron/ipc-validation.ts`.
- `electron/preload.ts` and `src/types/global.d.ts`: the real transport (`liveMemoryScanFirstStart`/`liveMemoryScanAobStart`/`liveMemoryScanCancel`/`liveMemoryScanPoll`) and its renderer-facing type contract, with `valueBigint` typed as a decimal string (never a plain `number`), matching mission §13's requirement that a future consumer cannot be handed a lossy int64/u64 value.
- `ScannerBackendRouter` (`src/core/live-memory/scanner-backend-router.ts`): fixed a real gap found while wiring this — `SHADOW_COMPARE`'s shadow native call never received `control` at all (`this.native.exactScan(primitiveType, valueNumber, valueBigint, bounds)` — 4 args, no 5th). A cancellation during shadow compare would have stopped the authoritative legacy call but left the shadow native scan running indefinitely. Fixed for both `routedExactScan` and `routedAobScan`; proven with 2 new deterministic unit tests (`scanner-backend-router.test.ts`) using a stub backend that records the `control` object it actually received.

## Real evidence (not synthetic)

`tests/live-memory/scanner-backend-cancellation.test.ts` — all against a real spawned fixture process, through the real registered `ipcMain.handle` callbacks:

| Case | Result |
|---|---|
| A/C/D — mid-flight cancellation of a real high-density exact scan | **PROVEN GENUINE**: one of up to 5 retried attempts observed `status: 'cancelled'` with `regionsScanned: 3` (out of a scan that would otherwise read far more) — the operation stopped mid-scan, not merely at a pre-flight check. Full observed result: `{"status":"cancelled","result":{"matches":[],"regionsScanned":3,"bytesScanned":0,"truncated":true,"backend":"native",...}}` |
| B — AOB scan start/cancel | PASS — completes without crash/hang; AOB's fast first-match search frequently finishes before the cancel lands, and both `cancelled` and `complete` are accepted as honest outcomes (never `error`) |
| E — duplicate cancel request | PASS — idempotent, both calls report `found: true`, no throw |
| F — cancel unknown operation ID | PASS — `found: false`, no crash |
| G — cancel an already-complete operation | PASS — `found: true, alreadyTerminal: true` |
| H — cancel after the target process exits | PASS — no hang, reaches a terminal state |

8/8 rollback-matrix case 5 (`scanner-backend-rollback-matrix.test.ts`) additionally proves a cancelled operation does not corrupt routing state: cancel under NATIVE, drain to terminal, switch to LEGACY, new scan succeeds, switch back to NATIVE.

## Preload cancellation contract (mission §3)

**REAL UI CONSUMER: ABSENT** — no renderer component currently initiates a scan. Per mission §3's own explicit carve-out ("a real preload-contract integration test is sufficient... do not invent fake UI"), the real IPC-path tests above ARE the preload-contract certification: they exercise the actual registered handlers a real UI would call, through the actual channel names `liveMemoryScanFirstStart`/`liveMemoryScanCancel`/`liveMemoryScanPoll` expose in `preload.ts`.

**PRELOAD CONTRACT: CERTIFIED.**

## Honest gaps

- Legacy's own cancellation remains pre-flight-only (`checkNotAborted`, checked once before the scan loop starts) — this is a real, documented asymmetry (`scanner-backend.ts`'s `ScanControl` doc comment), not new to this pass and not hidden.
- AOB cancellation could not be forced to land genuinely mid-flight in this pass's testing (its first-match search is typically too fast) — the test honestly accepts either terminal outcome rather than asserting a specific one it cannot reliably produce.

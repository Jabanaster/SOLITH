# Phase 1 / Stage 7 Final Closure — Routing and Rollback

## §8 — routing modes, real, observable, explicit

Three modes exist: `LEGACY` (default), `NATIVE`, `SHADOW_COMPARE`. No AUTO/CANARY mode exists — not needed to document separately.

**Configuration source**: `LiveMemorySession.setScannerRoutingMode(mode)` / `getScannerRoutingMode()`, backed by `ScannerBackendRouter`'s `mode` field — a real runtime property, not a compile-time constant or build flag.

**Runtime selection, real IPC-observable proof** (`scanner-backend-ipc-real-path.test.ts`, real fixture process): `live-memory-scanner-routing-mode-get` on a fresh session returns `LEGACY`; `live-memory-scanner-routing-mode-set` to `SHADOW_COMPARE` then `NATIVE` both take effect immediately and are independently confirmed via a subsequent `-get` call; a real scan issued after each mode switch actually used that backend (`result.backend` field matches the just-set mode). This is real runtime behavior, not a mock — the same test proved rollback (`NATIVE` → `LEGACY`) takes effect on the very next real call with no residual native routing.

**Default backend selected**: `LEGACY`, confirmed both by source (`ScannerBackendRouter`'s constructor default) and by the real IPC test above.

**Diagnostic output**: `session.getScannerBackendDiagnostics()` / the router's `diagnostics()` method returns `{ mode, allowFallbackToLegacyOnNativeFailure, lastOperation, operationCount, fallbackCount }` — real, inspectable state, exposed through `live-memory-scanner-routing-mode-get`'s response.

**Silent fallback**: NONE by default. `NATIVE` mode rethrows on native failure (proven real in `scanner-backend-ipc-real-path.test.ts`'s "native backend error surfaces as a typed failure" test — a real process killed mid-session produces a typed `{success: false, error: 'scan_first_failed'}` response, not a silent switch to legacy). `allowFallbackToLegacyOnNativeFailure` is a real, separate, canary-only opt-in flag that — when explicitly enabled by whoever constructs the router — always records BOTH the failure and the fallback in diagnostics (never silent even when enabled). Production code (`live-memory-session.ts`'s `getOrCreateBackendRouter`) does not enable this flag — confirmed by reading the construction call site.

## §9 — SHADOW_COMPARE correctness

Verified (unit level, `scanner-backend-router.test.ts`, real-process level, `scanner-backend-real-process.test.ts` and doc 91's 3 real games):

- **Executes both backends**: confirmed — `native.attachCalls.length === 1` assertions and real dual-scan evidence (legacy AND native metrics both present in every SHADOW_COMPARE result).
- **Compares and classifies differences**: confirmed — every real difference observed across this entire operation (Stage 7 through this pass) was classified into one of the five real enum values, zero left unclassified.
- **Returns only the authoritative (legacy) backend's result to the caller**: confirmed — `assert.deepEqual(result, legacyOutcome, ...)` in the unit test, and every real SHADOW_COMPARE result's `backend` field reads `'legacy'`.
- **Does not double-send results / double-emit progress**: by construction — `routedExactScan`'s SHADOW_COMPARE branch calls each backend's `exactScan` exactly once (one `await` each), returns one result object. No test found a double-emission because the code path structurally cannot produce one (single linear await chain, no retry loop in this branch).
- **Does not double-consume cancellation**: the `control` object (with its `AbortSignal`) is passed to both backend calls; `AbortSignal`'s `aborted` state is a passive read, not a consumable resource — both backends observing the same signal is the correct behavior (both must stop if the caller cancels), not a bug.
- **Does not mutate the same session twice / does not leak a second handle**: `ensureNativeAttached(pid)` attaches native at most once per pid per router instance (explicit unit test, "native attached at most once per pid across repeated calls" — passes). Legacy's handle is the session's pre-existing handle, never re-opened by `LegacyScannerBackend` (constructor takes the existing handle, `attach()`/`detach()` are no-ops by design).
- **Does not duplicate persistent-state writes**: N/A for exact/AOB scan — read-only operations, no persistent state is written by either backend during a scan.

**Shadow-mode authoritative backend**: `legacy`, always, by design — documented in `scanner-backend-router.ts`'s own doc comments and confirmed by every real and synthetic test.

## §12 — runtime rollback, real evidence

Rollback (`NATIVE` → `LEGACY`, no source edit, no rebuild) proven for:

| Case | Evidence |
|---|---|
| 1. Successful native exact scan | `scanner-backend-ipc-real-path.test.ts` — real >1 MiB sentinel scan (NATIVE), then mode-set to LEGACY, then a clean new legacy scan for the same value on the same session — legacy correctly still misses it (same real defect, unmodified) |
| 2. Successful native AOB | same test file — real AOB scan (NATIVE) succeeds, then mode-set to LEGACY, subsequent scans use legacy cleanly |
| 3. Invalid primitive input | not separately tested this pass (see doc 96 for the honest gap) |
| 4. Malformed AOB | `scanner-backend-ipc-real-path.test.ts` — malformed AOB request rejected by schema, then a valid AOB scan immediately afterward on the SAME session succeeds (proves the rejection didn't corrupt session state), independent of the LEGACY rollback test |
| 5. Cancelled scan | **not tested this pass** — no cancellation wire field exists on `live-memory-scan-first`/`live-memory-scan-aob` (doc 89/92); rollback-after-cancel cannot be exercised through the real IPC path until that gap is closed. Unit-level, `LegacyScannerBackend`/`NativeScannerBackend` both correctly reject a pre-aborted `AbortSignal` with a typed `ScannerBackendError('cancelled', ...)` (existing Stage 7 tests) — but that is not the same as "rollback after a scan that was cancelled mid-flight," which requires the wire cancellation gap closed first |
| 6. Target exits during native scan | `scanner-backend-ipc-real-path.test.ts`'s "native backend error surfaces as a typed failure" test — real process killed mid-NATIVE-mode-session, next scan returns a typed failure, not a crash. A subsequent LEGACY-mode scan on the SAME (now-dead) session was not separately re-tested (the dead process makes any further real scan meaningless regardless of backend) |
| 7. Resource limit | `scanner-backend-real-process.test.ts`'s maxMatches matrix and 100k pressure tests — hitting the cap reports `resource_limit` honestly; a subsequent LEGACY-mode scan after a resource-limited NATIVE scan was not separately tested this pass |
| 8. Native backend/load failure, safely injectable | `scanner-backend-router.test.ts`'s unit-level "NATIVE mode rethrows on failure" and "rollback after a native error stops native from being called again" tests — synthetic (`StubBackend`), not real-process, but directly exercises the exact rollback-after-native-error code path |

**No stale native session reused; no corrupted global routing state; no app corruption** — confirmed by construction (the router holds mode as a plain field, mutated only by `setMode`/`setScannerRoutingMode`, with no cross-session shared mutable state — each `LiveMemorySession` owns its own `ScannerBackendRouter` instance) and by every real test above completing without error after a mode switch.

**Honest gap**: cases 3 (invalid primitive input) and full round-trip re-verification for cases 6/7 (a fresh clean LEGACY scan specifically after target-exit/resource-limit, not just after a generic native error) were not separately exercised this pass. Reported here rather than assumed passing.

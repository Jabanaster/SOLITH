# Phase 1 / Stage 7.1 — Production IPC-Path Validation

## §7.1-C/§7.1-D — real route, no `NativeScanTarget` shortcut

**Method**: `electron` cannot be imported outside a real Electron process, and this repo's test suite runs under plain `tsx --test` (see `tests/electron-boundary-static.test.ts`'s existing convention of static analysis instead of runtime import for `electron/*.ts`). To exercise the **actual registered** `ipcMain.handle` callbacks from `electron/live-memory-ipc.ts` without standing up a full Electron app, `tests/live-memory/scanner-backend-ipc-real-path.test.ts` installs a Node module-customization-hooks loader (`tests/live-memory/fixtures/electron-loader.mjs`) that redirects the bare specifier `'electron'` to a minimal mock (`fixtures/electron-ipc-mock.mjs`) exposing only what `live-memory-ipc.ts` (and `avowed-wingdk-backup-watch.ts`) actually touch at runtime: `ipcMain.handle`, `app.getPath`, `BrowserWindow.getAllWindows`. Every layer below that — `registerLiveMemoryIpc()`'s real handler functions, schema validation, sender-trust validation, `LiveMemorySession`, `ScannerBackendRouter`, `NativeScannerBackend`, the real napi addon, the real Rust scanner, real serialization — runs unmodified, against a real spawned `solith-scanner-fixture.exe` process. This is not a router-level shortcut: the test calls `mock.__invoke('live-memory-scan-first', event, payload)`, which resolves to the exact function object `ipcMain.handle` registered.

**A real, previously-undiscovered bug found while building this test, fixed before it could ship**: `LiveMemorySession.scanExactViaBackend` derived its int64 search value via `BigInt(Math.trunc(targetValue))`, where `targetValue` is a `number` — already lossy beyond `Number.MAX_SAFE_INTEGER` by the time it reached that line. Stage 7's real-process proof that native preserves exact int64 values (doc 76) tested `LegacyScannerBackend`/`NativeScannerBackend` directly, bypassing `LiveMemorySession` entirely — so the actual session/IPC layer had never been proven to preserve int64 fidelity, and in fact could not have, by construction. **Fix**: `scanExactViaBackend` now accepts an optional `exactTargetValueBigint: bigint` parameter, used verbatim when present (falls back to the old lossy derivation only when absent, preserving existing callers); `LiveMemoryScanFirstSchema` gained an optional `targetValueBigint: z.string().regex(/^-?\d{1,20}$/)` wire field; the `live-memory-scan-first` handler parses and forwards it. This is a real product fix, not test scaffolding — without it, the INT64 shipping defect could never be closed through the real app route no matter what the backend does, because the value would already be corrupted before reaching the backend. See `src/core/live-memory/live-memory-session.ts`, `electron/ipc-validation.ts`, `electron/live-memory-ipc.ts`.

## Results — `full production IPC path` test (PASS)

Through the real registered handlers, against a real fixture process:

| Step | Result |
|---|---|
| `live-memory-attach` | real target-authorization check, real protected-target check, real OS process-identity verification, real handle open — all pass against `solith-scanner-fixture.exe` |
| `live-memory-scanner-routing-mode-get` (fresh session) | `LEGACY` (confirms mission §7.1-N's default) |
| `live-memory-scanner-routing-mode-set` → `SHADOW_COMPARE` → `NATIVE` | requested mode == observed mode both times |
| `live-memory-scan-first`, u32, real >1 MiB sentinel, NATIVE | found, `backend: 'native'` |
| `live-memory-scan-first`, i64, real unaligned value beyond 2^53, NATIVE, using the new `targetValueBigint` wire field | found, exact `valueBigint` round-trip confirmed on the wire (string-for-string equality) — the fixed path, proven |
| `live-memory-scan-aob`, real far-offset (>1 MiB) marker, NATIVE | found, `backend: 'native'` |
| `live-memory-scan-first`, u32, random absent value, NATIVE | 0 matches (real no-match, complete-enough case) |
| `live-memory-scan-aob`, malformed signature (`'ZZ'`) | rejected by real schema validation (`success: false`), no throw, no crash |
| `live-memory-scanner-routing-mode-set` → `LEGACY` | takes effect on the very next real call — no residual native routing |
| `live-memory-scan-first`, u32, same real >1 MiB sentinel, now LEGACY | 0 matches, `truncated: true` — legacy still honestly reports the same real, unmodified defect after rollback |
| `live-memory-detach` | success |

## Results — `native backend error surfaces as a typed failure` test (PASS)

Real process killed mid-session while `NATIVE` mode is active; the next `live-memory-scan-first` call against the now-dead PID returns `{ success: false, error: 'scan_first_failed' }` through the real handler — no uncaught rejection, no silent fallback to legacy, no crash. This is real evidence for mission §7.1-C's "process exit" and "native backend error" required cases, and for §7.1-N's "no silent fallback" requirement, all through the real route.

## Honest gaps — NOT exercised by this pass, mission §7.1-C's full required list

| Required case | Status | Why |
|---|---|---|
| exact primitive | **DONE** | u32 sentinel case above |
| unaligned primitive | **DONE** | the i64 case's fixture value is unaligned by construction (offset 449) |
| i64/u64 > 2^53 | **DONE** | fixed this stage; see the int64 bug above |
| AOB | **DONE** | far-offset marker case above |
| >1 MiB target | **DONE** | same sentinel case (region is 4 MiB) |
| no-match complete | **DONE** | random-value case above |
| no-match incomplete | **DONE** | the post-rollback legacy re-scan (`truncated: true`, 0 matches) |
| cancellation | **NOT DONE — structural gap, not a test gap** | `LiveMemoryScanFirstSchema`/`LiveMemoryScanAobSchema` expose no `AbortSignal`-equivalent field at all. The internal `ScanControl.signal` plumbing exists in `ScannerBackend`/router/native backend, but `live-memory-scan-first`/`live-memory-scan-aob` never construct or pass a `control` argument — there is currently no way for a renderer to cancel an in-flight scan through the real IPC contract. This is a genuine, previously-undocumented wire-contract gap, not something this pass silently patched: adding real mid-flight cancellation wiring (a cancel channel, a scan-id to cancel, renderer-side UI) is a real feature addition beyond "close the remaining Stage 7 gaps," and mission text does not authorize inventing new IPC surface area beyond what's needed to prove existing behavior — unlike the int64 fix above, which was required just to make an EXISTING claimed capability (int64 fidelity) actually reachable through the real route. Left OPEN, reported here rather than assumed or faked. |
| native backend error | **DONE** | process-exit case above (the concrete, reproducible instance of a native backend error this stage could exercise safely) |
| malformed AOB | **DONE** | schema-rejection case above |
| process exit | **DONE** | native-error test above |

**Net**: 10 of 11 required IPC-path cases are now proven through the real registered handlers against a real process. The 1 gap (cancellation) is a genuine, newly-documented wire-contract limitation — not a defect this stage introduced, but a pre-existing absence this stage's "no shortcut" testing requirement was thorough enough to surface. It blocks full certification of mission §7.1-S's "full IPC path proven" gate item as unconditionally complete; §7.1-S is evaluated as PARTIAL for this reason in doc 96.

## §7.1-D — production mode control (PASS, real)

Verified through the real `live-memory-scanner-routing-mode-get`/`-set` handlers: requested mode is always the observed mode; no hidden fallback; a session never swaps backend mid-scan (mode changes only affect the next routed call, verified by the LEGACY re-scan after rollback still landing on `legacy`, not `native`, even though the mode-set call happened after the SHADOW_COMPARE/NATIVE calls in the same session).

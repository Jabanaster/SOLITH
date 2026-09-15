# Phase 1 / Stage 7 Final Closure — Failure Injection

## §13 — production path failure survival, per case

| Failure | Evidence | Result |
|---|---|---|
| Missing native addon | `NativeScannerBackend.loadNativeScannerAddon()`'s `native_addon_missing`/`native_addon_load_failed` typed errors; exercised at the unit level in `scanner-backend-router.test.ts` (`StubBackend` throwing `ScannerBackendError('native_addon_missing', ...)`) | structured error, no crash — **synthetic, not a real missing-addon environment** |
| Corrupt/wrong addon, load failure | same mechanism (`native_addon_load_failed`) | structured error path exists; **not separately exercised with an actually-corrupted `.node` file this pass** |
| Unsupported architecture | not simulated — would require a non-x64 build artifact, not available in this environment | **not tested** |
| Access denied | `ScannerBackendError`'s `access_denied` kind exists in the type union (`scanner-backend.ts`) | **no test exercises this specific kind this pass** — real access-denied conditions (e.g., scanning a higher-privilege process) were not induced |
| Process exits during scan | `scanner-backend-ipc-real-path.test.ts`'s real-process-kill test; `scanner-backend-real-process.test.ts`'s prior stage tests | **real, proven** — typed failure, no crash, no silent fallback |
| Resource limit | `scanner-backend-real-process.test.ts`'s maxMatches matrix + 100k pressure tests | **real, proven** — honest `resource_limit` completeness, bounded, no crash |
| Cancellation | `scanner-backend-legacy.test.ts`'s pre-aborted-signal test (both backends) | **real for pre-abort only**; mid-flight cancellation not reachable through the real IPC route (no wire field — doc 89) |
| Invalid data type | IPC schema (`LIVE_VALUE_TYPE` enum) rejects any value outside the 6 known types before reaching the backend | **real, by construction** — not separately re-tested this pass, but the zod enum's own existing schema tests cover it |
| Invalid exact value (e.g., NaN/Infinity) | `LiveMemoryScanFirstSchema.targetValue: z.number().finite()` rejects non-finite values at the schema layer | **real, by construction** |
| Malformed AOB | `scanner-backend-ipc-real-path.test.ts`'s malformed-signature test (`'ZZ'`, rejected by `z.string().min(3)`) | **real, proven** — rejected cleanly, session survives (rollback proof #4, doc 95) |
| Corrupt persisted session metadata | no persisted session metadata exists for scan operations (sessions are in-memory, keyed by `event.sender.id`, torn down on detach/destroy) — this failure class does not apply to the scanner route this stage covers | **not applicable** |
| Closed session reuse | `requireSession`/`requireBundle` throw if no bundle exists for the sender id after `detach()` — real, by construction (confirmed by reading `live-memory-ipc.ts`); **not separately covered by a new test this pass** |
| Double close (double `detach()`) | `LiveMemorySession.detach()` is idempotent by construction — every field it clears is guarded (`if (this.handle) ...`, optional chaining on `this.backendRouter`) — a second call is a safe no-op. **Verified by code inspection, not a new dedicated test this pass** |

## Required outcomes, assessed

- **Structured error**: YES for every case actually exercised (missing addon, process exit, resource limit, malformed AOB, pre-abort cancellation, invalid schema input).
- **No crash, no hang**: YES for every case actually exercised — confirmed by every test completing within its timeout with a returned value, not a thrown/uncaught exception escaping the handler.
- **No silent success**: confirmed — every failure case returns `{success: false, error: ...}` or throws a typed, caught `ScannerBackendError`; no case silently reports success while having failed.
- **No accidental authoritative-not-found**: confirmed by construction and tests — `isAuthoritativeAbsence` is `false` whenever completeness is not `'complete'`, checked explicitly in multiple tests (doc 89's no-match tests, the real-game canary's `isAuthoritativeAbsence: false` fields).
- **No silent legacy fallback unless explicitly permitted**: confirmed (doc 95's routing section) — `NATIVE` mode rethrows by default; the opt-in fallback flag always records both the failure and the fallback.

## Honest gaps

Unsupported-architecture and genuinely-corrupted-addon-file scenarios were not simulated (would require a non-native build artifact or deliberately truncated `.node` file, not attempted this pass). Access-denied was not induced against a real higher-privilege target. Closed-session-reuse and double-close are verified by code inspection only, not by a dedicated new automated test this pass. These are reported here as open verification items, not silently assumed passing.

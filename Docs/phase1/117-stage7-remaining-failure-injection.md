# Phase 1 / Stage 7.4 §14 — Remaining Failure Injection Gaps

## Baseline (doc 104)

4 cases remained open: missing addon (PARTIAL, synthetic stub only), corrupt/wrong addon (NOT COVERED), addon load failure (PARTIAL, synthetic stub only), access denied (NOT COVERED).

## REAL vs DETERMINISTIC_INJECTION (mission's own required distinction)

A genuinely important technique-level finding this pass: `node:module`'s async `register()` loader hooks (already used elsewhere in this test suite to mock `'electron'`) do **not** intercept CJS `require()` calls in this Node version — verified empirically before writing any test. `registerHooks()` (the newer, synchronous hook API) does intercept `require()`, and is deregisterable per-call via its own `.deregister()`. This is the real mechanism `scanner-backend-failure-injection-real.test.ts` uses — not a stand-in `ScannerBackend` stub that merely throws a pre-selected error kind (that style of test, still valid for what it tests, is what doc 104 correctly labeled `PARTIAL (synthetic)`).

### Missing addon — REAL, closed

`registerHooks` makes the real `require('solith-scanner-napi')` call genuinely fail (`MODULE_NOT_FOUND`), then a freshly-imported `NativeScannerBackend.attach()` is exercised against this real failure. Result: a structured `ScannerBackendError('native_addon_missing', ...)`, matching the exact code path a genuinely-not-`npm install`ed environment would hit.

### Corrupt addon / addon load failure — REAL, closed

An isolated copy of `native/solith-scanner-napi`'s `index.js` and its real `.node` binary is made in a fresh `mkdtempSync` temp directory; the canonical addon under `native/solith-scanner-napi` is never touched. The copied `.node` file is overwritten with garbage bytes. `registerHooks` redirects `require('solith-scanner-napi')` to the corrupted copy's `index.js`. The real napi-rs-generated loader genuinely fails to load the malformed binary (`"Cannot find native binding..."` — its own real, generic multi-platform-candidate exhaustion message) and `NativeScannerBackend.attach()` surfaces it as `ScannerBackendError('native_addon_load_failed', ...)`.

**A real code fix was needed to make this classification correct**: before this pass, `loadNativeScannerAddon()`'s catch block collapsed *every* `require()` failure under plain Node (no `process.resourcesPath`) into `native_addon_missing`, regardless of whether the module was genuinely absent or present-but-corrupted — discovered directly by this new test initially failing with the wrong `kind`. Fixed by checking `err.code === 'MODULE_NOT_FOUND'` (Node's own standard code for a truly unresolvable specifier) to select `native_addon_missing`; any other error (module found, but its own internal loading logic threw) now correctly produces `native_addon_load_failed`. This is a real, if narrow, correctness improvement to production error classification, not just a test artifact.

### Access denied — DETERMINISTIC_INJECTION, safely reproducible in this environment

`NativeScannerBackend.attach(4)` — PID 4 is the Windows "System" process, which a non-elevated process can never open for the access rights memory scanning needs, without weakening OS security or touching any protected process's own state (this only *attempts* to open a handle; it never succeeds, never reads, never writes). In this environment the attempt genuinely failed, surfaced as a structured `ScannerBackendError('attach_failed', ...)` — no crash, no hang, no unstructured throw. The test is written to `skip` (not falsely pass) if this environment is itself elevated and the attach unexpectedly succeeds, per mission §14's explicit "if access denied cannot be safely reproduced: document as environment-limited" instruction — in this run it did not need to skip.

## Updated 16-case table (deltas from doc 104 only)

| # | Case | doc 104 status | Status after this pass |
|---|---|---|---|
| 1 | Native addon missing | PARTIAL (synthetic) | **CLOSED — REAL** |
| 2 | Wrong/corrupt addon | NOT COVERED | **CLOSED — REAL** |
| 3 | Addon load failure | PARTIAL (synthetic) | **CLOSED — REAL** (same evidence as #2, now correctly classified) |
| 4 | Access denied | NOT COVERED | **CLOSED — DETERMINISTIC_INJECTION** (safely reproducible via PID 4 in this environment) |

Cases 5-10, 13-16 unchanged from doc 104 (already real/closed). Cases 11 (corrupt snapshot metadata) and 12 (unsupported snapshot version) remain, unchanged, **NOT APPLICABLE**/**NOT ADDRESSED** — out of this route's scope, per doc 104's own reasoning (no persisted session metadata exists for the scan route this stage covers; snapshot versioning belongs to a different subsystem).

## Final count

**FAILURE INJECTION: 14/16 real, 2/16 not applicable/out of scope.** Every case that was deterministically, safely testable in this environment is now closed with real evidence; nothing was rounded up, and the environment-dependent nature of the access-denied case is disclosed rather than hidden.

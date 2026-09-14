# Phase 1 / Stage 4 — napi Session Contract

## Class: `NativeScanSession`

`native/solith-scanner-napi/src/lib.rs`. Wraps `Arc<Mutex<Option<solith_scanner_core::session::ScanSession>>>` — the same "shared, mutex-guarded, `Option`-wrapped inner state" pattern `NativeScanTarget` already uses for its `ProcessHandle` (Stage 2), reused rather than re-invented. The Rust `ScanSession`/`ProcessHandle` are never exposed to JS directly (mission §4.14's explicit "do not leak Rust/internal handles" rule) — every method returns a plain-data shape (`JsRefineOutcome`, `JsSessionStatus`, `JsGenerationRecord`, `Vec<JsScanMatch>`) or throws a stable-prefixed error.

## Lifecycle

```ts
const session = new NativeScanSession();               // synchronous, holds no target yet
const outcome = await session.createUnknownInitial(     // async — the real baseline capture
    pid, regions, primitiveType, alignment,
    chunkSizeBytes, overlapBytes,
    maxCandidates, maxSnapshotBytes, maxSessionBytes,
    cancellation, progress);
const refined = await session.refine(                    // async — repeatable
    mode, valueNumber, valueBigint,
    minNumber, minBigint, maxNumber, maxBigint,
    cancellation, progress);
const page = session.getResults(offset, limit);           // sync — bounded page
const history = session.generationHistory();               // sync — bounded by maxGenerationsRetained
const status = await session.status();                     // sync in Rust; awaited here only because
                                                             // the conceptual API name suggests it — actual
                                                             // return is a plain value, not a Promise (see below)
session.close();                                            // sync — releases immediately
```

Note: `status()`, `getResults()`, `generationHistory()`, `isInitialized()`, and `close()` are **synchronous** in the actual generated `index.d.ts` (plain in-memory reads/mutations, not re-reads of target memory) — the `await` in the sketch above is harmless (`await` on a non-Promise value just resolves immediately) but not required. `createUnknownInitial()` and `refine()` are the only two async, `Promise`-returning methods, matching mission §4.14's "async/non-blocking" requirement for the operations that actually touch target memory.

`createUnknownInitial` may be called **exactly once** per `NativeScanSession` instance — a second call throws `invalid_configuration: session already initialized`. `refine`/`getResults`/`generationHistory`/`status` before the first successful `createUnknownInitial` throw `invalid_configuration: session not yet initialized`.

## BigInt-safety (mission §4.14)

Every 64-bit-magnitude value crosses as `BigInt`, never `Number`: `chunkSizeBytes`, `overlapBytes`, `maxCandidates`/`maxSnapshotBytes`/`maxSessionBytes` (all optional `BigInt | null`), and every result field that can exceed `Number.MAX_SAFE_INTEGER` (`inputCandidateCount`, `outputCandidateCount`, `bytesReread`, `skippedReads`, `candidateCount`, `candidateMemoryBytes`). Per-candidate *values* use Stage 3's already-proven value-duality contract unchanged: `valueNumber` XOR `valueBigint`, selected by `PrimitiveType::requires_bigint_for_js()` (i64/u64 only) — `getResults()` returns `JsScanMatch` objects (Stage 3's own shape, reused directly rather than duplicated) via the same `scan_match_to_js` conversion `scanExact` already uses.

## Bounded result pages (mission §4.14)

`getResults(offset: BigInt, limit: number)` never marshals more than `limit` candidates in one call, regardless of how large the session's total candidate count is — it is a thin wrapper over `ScanSession::candidates_page`, which itself never allocates more than the requested page (doc 29).

## Generation metadata (mission §4.14)

`generationHistory(): JsGenerationRecord[]` exposes the full, bounded history (doc 27/28's `GenerationRecord`) as one array — small and cheap by construction, since `maxGenerationsRetained` (default 64) caps its size regardless of how many refinements have actually run.

## Completeness (mission §4.14)

Every async method's result carries a `completeness: JsCompleteness` — the exact same shape (`state`/`atByte`/`skipped`/`failedReason`) Stage 2/3 already established and that TypeScript callers already know how to interpret; Stage 4 introduces no new completeness vocabulary.

## Cancellation / progress (mission §4.14)

Both `createUnknownInitial` and `refine` accept the *same* `ScanCancellationHandle`/`ScanProgressHandle` classes Stage 2/3 already export — no new cancellation/progress type was introduced. A caller can create one pair per operation (as the tests do) or reuse handles across calls as suits its own control flow; the classes themselves are stateless with respect to which operation they're passed to.

## Stale-target errors (mission §4.14)

`status().isStale` is a live (never cached) boolean. `refine()`/`createUnknownInitial()` against an exited target throw `target_exited: ...` (the stable-prefix contract, doc 14/22) as a rejected `Promise` — except the specific pre-flight "not yet initialized" / "already closed" checks in `refine()`/`createUnknownInitial()` itself, which are synchronous validation and therefore throw **synchronously** (before any `Promise` is constructed), matching how every other synchronous-validation-then-async-work method in this crate already behaves (e.g. `scanExact`'s `primitive_type_from_str` validation). Documented explicitly here because it is the one place a JS caller must remember to wrap in `assert.rejects(async () => ...)` rather than a bare arrow function if testing for it (see doc 32's test file for the concrete case this bit the test author once, self-caught and fixed before certifying).

## Session cleanup (mission §4.14/§4.15)

`close()` sets the shared `Option` to `None`, which drops the `ScanSession` (RAII: closes the `ProcessHandle`, deallocates `CandidateStore`) synchronously and immediately — never deferred to JS garbage collection. Safe to call multiple times, and safe to call before `createUnknownInitial` ever succeeded. See doc 35 for the real repeated-cycle handle-leak proof.

# Phase 1 / Stage 4 — Session Model

## Location

`native/solith-scanner-core/src/session.rs` — new module, built directly on Stage 2's chunk/reader primitives and Stage 3's `PrimitiveType`/`PrimitiveValue`/`AlignmentMode`.

## `ScanSession` — required fields (mission §4.1)

| Mission bullet | Field(s) | Notes |
|---|---|---|
| scan/session ID | *(napi-layer object identity)* | The Rust struct itself has no numeric ID field — a `ScanSession` is a Rust value owned by exactly one `NativeScanSession` napi object, and JS object identity (the class instance itself) *is* the session identifier. No separate ID needed inside a single-owner value type; a future multi-session-registry design (if ever needed) would add one at that layer, not here. |
| target process identity | `identity: ProcessIdentity { pid, creation_time_filetime }` | See doc 30. |
| process handle ownership | `handle: ProcessHandle` | Owned outright, RAII `Drop` closes it. Never shared with another session or a `NativeScanTarget` attach. |
| process architecture | *(available via `handle.detect_architecture()`, not cached)* | Deliberately not cached as a field — architecture is a property of the live handle, and re-querying it costs one cheap syscall; caching risks staleness for no benefit. |
| process creation/start identity | `identity.creation_time_filetime` | Real `GetProcessTimes` value — see doc 30. |
| game/build identity placeholder | *(not added)* | No such placeholder exists anywhere else in this crate's Stage 1-3 types either; this crate's Stage 1 architectural boundary (see `target.rs`'s own module doc) explicitly keeps game/build identity a TypeScript-layer concern, passed in only as opaque hint strings where needed. Stage 4 does not introduce a native-side placeholder for something Stage 1-3 deliberately never modeled. |
| primitive type | `primitive_type: PrimitiveType` | Stage 3's type. |
| initial scan mode | *(implicit: `create_unknown_initial` is the only initial-scan constructor)* | There is exactly one initial-scan mode this stage implements (`UNKNOWN_INITIAL`), so there is nothing to store — the mode is `create_unknown_initial` itself, not a runtime value. A future stage adding e.g. `KNOWN_INITIAL` would add a real field then. |
| alignment mode | `alignment: AlignmentMode` | Stage 3's type, reused unchanged. |
| region policy | *(applied at capture time, not retained)* | `RegionSelectionPolicy` is consumed by `create_unknown_initial` to select which regions to capture from; it is not retained on the session afterward because `refine()` never re-applies region policy — it only re-reads the specific addresses already captured. Retaining an unused field would violate the "no unnecessary state" principle this session type otherwise follows strictly. |
| chunk policy | `chunk_config: ChunkPlanConfig` | Retained and exposed via `chunk_config()` for status/diagnostics, per the mission's explicit "chunk policy" bullet — even though `refine()`'s own re-read batching (`build_read_spans`) uses an independent, fixed span cap rather than this value directly (documented in doc 28). |
| candidate representation | `candidates: CandidateStore` | See doc 29. |
| previous-value representation | *(same `CandidateStore`)* | This architecture does not keep separate "previous" vs. "current" arrays — each refine overwrites the stored value in place with the freshly-read current value, which *becomes* the next refinement's "previous" value. See doc 28 for why this is an explicit, tested design choice rather than an oversight. |
| completeness | `last_completeness: ScanCompleteness` | Updated by every capture/refine. |
| skipped-region metadata | *(inside each `GenerationRecord.completeness`, not a separate session field)* | `ScanCompleteness::CompleteWithSkippedRegions{skipped}` already carries this; duplicating it as a second session-level field would be redundant state that could drift out of sync with the record it's copied from. |
| progress | *(delivered via the caller-supplied `on_progress` callback during a call, not stored)* | Same poll/push-during-the-call design as Stage 2/3 — progress is a live view of an in-flight operation, not session state to persist between calls. |
| cancellation state | *(caller-supplied `&CancellationToken` per call, not stored)* | Each `create_unknown_initial`/`refine` call takes its own token, matching Stage 2/3's per-operation (not per-session) cancellation model — a session does not have one persistent "cancelled" flag because a *finished* operation's cancellation state is meaningless once it has already returned. |
| result count | `candidates.len()` / `candidate_count()` | Derived, not separately stored. |
| resource usage | `candidates.memory_bytes()` / `candidate_memory_bytes()` | Derived from `CandidateStore`'s own accounting (doc 29). |
| timestamps | `created_at: Instant`, `last_refined_at: Instant` | Both real, updated by `record_generation`. |

## Why a derived/non-stored field is not a gap

Every mission-listed bullet above is accounted for — the ones without a literal same-named struct field are either (a) genuinely computed from other state with no risk of staleness, (b) explicitly out of this stage's own scope per the crate's existing architectural boundary (game/build identity), or (c) deliberately per-call rather than per-session state, matching the same pattern Stage 2/3 already established for cancellation/progress. None of these were left out by oversight; each decision is documented at its own field's row above and cross-referenced to the doc that argues it in full (29, 30).

## Lifecycle

1. `ScanSession::create_unknown_initial(handle, regions, policy, primitive_type, alignment, chunk_config, resource_limits, cancellation, on_progress) -> ScannerResult<(ScanSession, ScanMetrics)>` — the only constructor. Takes ownership of `handle`. Records generation 0 (`mode_label: "unknown_initial"`) in the history immediately.
2. `session.refine(mode, cancellation, on_progress) -> ScannerResult<RefineOutcome>` — called any number of times, each advancing `generation` by 1 and appending a `GenerationRecord`.
3. `session.close(self)` — consumes `self`; RAII drop of `handle`/`candidates` does the actual release (see doc 35's handle-leak proof).

## "A session must not silently survive target-process replacement" (mission §4.1's closing sentence)

A `ScanSession` owns its `ProcessHandle` for its entire lifetime and never re-opens a handle by PID. See doc 30 for the full stale-target argument this guarantees.

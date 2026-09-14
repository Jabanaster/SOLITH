# Phase 1 / Stage 6 — Cancellation Hardening

## §6.5 — cancellation contract

`CancellationToken` (`cancellation.rs`) wraps `Arc<AtomicBool>`; `cancel()` stores `true` (`Ordering::SeqCst`), `is_cancelled()` loads it. This makes cancellation:

- **Cooperative** — checked explicitly at loop boundaries, never preemptive.
- **Prompt** — checked once per chunk/region/span, never once-per-whole-operation.
- **Deterministic** — every test in this suite synchronizes cancellation via the progress callback (`if m.chunks_read >= N { cancel_clone.cancel(); }`), which runs synchronously on the same call stack as the scan loop — no wall-clock sleep, no race window, per this mission's own "do not hardcode brittle wall-clock timing; use bounded evidence" instruction.
- **Race-safe** — `AtomicBool`, safe to `Clone`+`Arc` across the napi async-task thread boundary.
- **Idempotent** — calling `cancel()` twice is a no-op the second time (`store(true, ...)` again); proven at the napi layer too (a `ScanCancellationHandle` can be checked/cancelled repeatedly with no error).

### Tested across every required scan type

| Scan type | Test |
|---|---|
| Region enumeration | `region_enumeration_stops_immediately_when_pre_cancelled` (Stage 6, new) |
| Chunked read loop | `reader.rs`'s own existing chunk-loop cancellation checks, exercised via `cancellation_stops_a_scan_before_full_region_is_covered` |
| Primitive exact scan | `cancellation_stops_a_scan_before_full_region_is_covered`, `cancellation_preserves_matches_found_before_the_cancellation_point` (Stage 6, new) |
| Unknown-initial capture | `cancellation_during_unknown_initial_stops_before_full_region_is_covered` |
| Refinement | `cancellation_before_a_refine_preserves_every_candidate_unchanged` |
| String/byte/AOB (pattern) scan | `cancellation_stops_pattern_scan_before_full_region_is_covered` |
| Result generation/paging | Synchronous, in-memory slice (`candidates_page`) — not a candidate for mid-call cancellation; no real-world latency to cancel |

### Region enumeration: a real, honest gap closed halfway

`enumerate_regions` had **no cancellation parameter at all** before this mission. A new `enumerate_regions_with_cancellation(handle, start, Option<&CancellationToken>)` was added, checked once per `VirtualQueryEx` iteration, fully backward-compatible (`enumerate_regions` is now a thin wrapper passing `None`). `region_enumeration_stops_immediately_when_pre_cancelled` proves it against a real process's real address space.

**Honest limitation, not silently glossed over:** the napi `NativeScanTarget.enumerateRegions()` binding remains **synchronous** — a deliberate, evidence-based Stage 2 design decision (doc 16: region enumeration across a real process's full user-mode address space is bounded and fast in practice). A synchronous call blocks the JS thread for its own duration; there is no Promise pending for `cancellation.cancel()` to interrupt mid-call, so a cancellation signal sent from JS cannot reach this specific binding today regardless of the core-level support now added. This is not a regression — cancellation was never reachable here before either — but it means the new core-level capability is currently unused by the one real caller. If future evidence shows enumeration is slow enough on some real machine/process to need live cancellation, promoting this binding to an `AsyncTask` and wiring `cancellation.inner.clone()` through to `enumerate_regions_with_cancellation` is now a small, already-prepared follow-up, not a re-architecture.

## §6.6 — cancelled result semantics

- **Partial results are returned when the architecture permits it**, and are proven to be genuinely preserved, not incidentally absent: `cancellation_preserves_matches_found_before_the_cancellation_point` (Stage 6, new) plants two occurrences of the same value in different chunks, cancels between them, and asserts the first is present and the second is not — a real proof that cancellation returns partial data rather than discarding it.
- **Accurate completeness is preserved**: every cancellation path returns `ScanCompleteness::Cancelled { at_byte }`, never silently reported as `Complete`.
- **Bytes/regions processed are preserved**: `ScanMetrics` accumulates up to the cancellation point and is returned via the progress handle regardless of how the operation terminated.
- **Refinement's unprocessed candidates are handled exactly as designed**: `cancellation_before_a_refine_preserves_every_candidate_unchanged` proves an immediately-cancelled refine carries every not-yet-examined candidate forward unchanged — the session's candidate count is provably identical before and after.
- **Nothing is silently marked complete on cancellation** — confirmed by the invariant in doc 59 (`Cancelled` never coincides with `Complete` anywhere in the test suite).

# Phase 1 / Stage 4 — Refinement Semantics

All eight required modes (mission §4) are implemented in `native/solith-scanner-core/src/session.rs`'s `RefineMode` enum and `candidate_survives()` function: `UNKNOWN_INITIAL` (session constructor, not a `RefineMode` variant — see doc 27), `CHANGED`, `UNCHANGED`, `INCREASED`, `DECREASED`, `INCREASED_BY`, `DECREASED_BY`, `BETWEEN`.

## Snapshot-update model (mission §4.5)

**Explicit choice: single-generation snapshots, not versioned history.** Each `refine()` call re-reads every current candidate's live value, decides survival by comparing it against the *previous* stored value, and then **overwrites** the stored value with the freshly-read current value for every surviving candidate — becoming the "previous" value for the *next* refinement. There is no per-generation array of past values; `GenerationRecord` (doc 27) preserves the *audit trail* (counts, completeness, timing) of each generation, not a value-level snapshot to roll back to.

This is the mission's own explicitly-allowed default ("update previous snapshot to current value for the next refinement, **unless** architecture explicitly keeps versioned generations") — versioned per-generation value snapshots were considered and rejected for this stage on cost grounds: `CandidateStore` (doc 29) is already sized to be the majority of a session's memory footprint at scale, and retaining N generations of separate value arrays would multiply that cost by N for a feature (`undo to generation K`) mission §4.9 explicitly defers ("Do not implement full user undo UI yet"). `GenerationRecord`'s structured audit trail is exactly what mission §4.9 asks for to make that future feature *possible* without paying its cost now.

Tested by `changed_and_unchanged_partition_correctly_after_a_real_write`/`unchanged_survives_only_the_untouched_candidate` (Rust) and the JS equivalents (doc 32) — a real write between capture and refine 1, then between refine 1 and refine 2, must be independently observable at each step, which only holds if the stored "previous" value actually advances each generation.

## Integer semantics

Exact equality/ordering via `PrimitiveValue::eq_exact`/`compare_ordered` (both already defined in Stage 3's `types.rs`, reused unchanged for `CHANGED`/`UNCHANGED`/`INCREASED`/`DECREASED`). Signedness is respected natively — an `i8`/`i32`/`i64` compares as a signed Rust integer, a `u8`/`u32`/`u64` as unsigned; there is no bit-pattern-only comparison anywhere in this path. i64/u64 stay native Rust types through the entire compare (never widened through `f64`), continuing Stage 3's D06 fix into refinement.

## `INCREASED_BY`/`DECREASED_BY` — checked arithmetic (mission §4.7)

`PrimitiveValue::checked_increase_by`/`checked_decrease_by` (new in Stage 4's `types.rs` additions) use Rust's own `checked_add`/`checked_sub` per integer type: an overflow/underflow returns `None`, and `candidate_survives` treats `None` as "never matches" — **the candidate is excluded, not wrapped and compared against a wrapped value.** This is the mission's explicit "prefer checked numeric semantics... must not produce undefined/wrapped behavior unless wrapping is the chosen documented semantics" rule — wrapping was never chosen; checked-and-reject is the sole implemented semantics.

Proven directly: `increased_by_uses_checked_arithmetic_not_wrapping`/`decreased_by_rejects_underflow_for_unsigned` (pure unit tests) and `increased_by_matches_an_exact_delta_and_rejects_a_different_change`/`decreased_by_never_matches_a_real_unsigned_underflow` (real spawned-process integration tests, doc 32).

Float `INCREASED_BY`/`DECREASED_BY` has no overflow concept at real-world magnitudes and always returns `Some` (ordinary IEEE add/sub) — NaN/Infinity propagate exactly per IEEE-754, and the resulting `eq_exact` comparison already has explicit NaN semantics (below).

## `BETWEEN` (mission §4.8)

**Inclusive on both ends**, per the mission's own recommended default. `validate_refine_mode` rejects, up front (before any real memory is re-read), `min > max` and NaN bounds — `ErrorKind::InvalidConfiguration`, never a range comparison that silently never matches. Proven by `validate_refine_mode_rejects_inverted_between_bounds`/`validate_refine_mode_rejects_nan_between_bounds` (unit) and `between_filters_a_real_written_value_by_inclusive_range` (real spawned-process integration, doc 32).

## NaN/overflow/infinity/±0 policy — explicit table (mission §4.6/§4.12)

| Mode | NaN candidate | +Infinity vs finite | +0.0 vs -0.0 |
|---|---|---|---|
| `CHANGED` | Always survives, even against another NaN (`eq_exact(NaN,NaN)==false`, so "not equal" is always true) | Ordinary equality — `+Inf` changing to a finite value survives | `+0.0`/`-0.0` are exactly equal under `eq_exact` — never reported as "changed" from one another |
| `UNCHANGED` | Never survives, even against itself | Ordinary equality | Never reported as "changed," so always survives `UNCHANGED` when compared to the other zero |
| `INCREASED`/`DECREASED` | Never survives (`compare_ordered` returns `None` whenever either side is NaN — `matches!(None, Some(Greater))` is `false`) | `+Infinity` compares strictly greater than every finite value via ordinary `partial_cmp`; `-Infinity` strictly less | `+0.0`/`-0.0` compare equal (`partial_cmp` agrees with IEEE `==`), so neither is "increased" nor "decreased" relative to the other |
| `INCREASED_BY`/`DECREASED_BY` | `previous + delta` (or `-`) is NaN whenever either operand is NaN; `eq_exact(NaN, current)` is always `false`, so never survives | Ordinary IEEE arithmetic; `Infinity + finite == Infinity`, so a target that stays exactly `Infinity` after a finite delta survives | Ordinary IEEE arithmetic (`0.0 - 0.0 == 0.0`), and the ±0 equality rule above applies to the comparison |
| `BETWEEN` | Bounds containing NaN are rejected up front (`InvalidConfiguration`); a NaN **current** value never satisfies `compare_ordered` against either bound, so it is always excluded | `+Infinity` satisfies an unbounded-above range candidate only if `max` is itself `+Infinity` (ordinary `partial_cmp`) | Both zeros satisfy the same bound checks identically |

This is the same "ordinary IEEE-754 semantics, no hidden epsilon" contract Stage 3 established for exact scanning (`types.rs`'s `eq_exact` doc), extended consistently rather than re-invented for refinement — mission §4.12's explicit requirement.

Proven by `nan_is_always_changed_and_never_unchanged_even_against_itself`, `increased_decreased_never_match_when_either_side_is_nan` (unit), and `float_refinement_handles_nan_and_infinity_against_real_memory` (real spawned-process integration, doc 32).

## Partial-read / dropped-candidate policy (mission §4.10)

**Explicit choice: dropped, not deferred.** If a candidate's address falls inside a read span whose read failed entirely (`AccessDenied`/`InvalidAddress`/`OsError`) or was only partially successful (`PartialRead`, and this specific candidate's bytes fell past the OS-reported `bytes_read` boundary), that candidate is **excluded from the surviving set** — never silently kept as "still matches," never silently dropped without a trace. Every such exclusion increments `skipped_reads` and is recorded as a `SkippedRange` in the resulting `ScanCompleteness::CompleteWithSkippedRegions{skipped}` (never `Complete`).

"Deferred" (retry next generation, keep pending) was considered and explicitly **not** implemented this stage — it would require a third candidate state beyond "survived"/"excluded," adding real complexity for a benefit (retry-on-next-refine) no test or real usage pattern has yet justified. `skipped_reads` plus a non-`Complete` completeness already gives the caller everything needed to know *that* something was dropped and *how many* — a future stage can add retry semantics with real evidence for why drop-only is insufficient.

## Cancellation carries forward, never silently drops (mission §4.10's spirit extended to cancellation)

A `Cancelled`/`ProcessExited`/`ResourceLimit` termination mid-refine is handled differently from a read failure: every candidate that was **not yet examined** at the point of interruption is carried forward into the surviving set **completely unchanged** (its existing stored address/value, untouched), rather than being silently discarded. Only candidates that were *actually examined* (and either failed the filter or could not be read) are excluded. This means cancelling a refine never shrinks the candidate set by more than "genuinely decided against"; it never throws away candidates the operation simply never got to.

Proven by `cancellation_before_a_refine_preserves_every_candidate_unchanged` (Rust, doc 32) and the JS equivalent — an immediate cancellation (`cancellation.cancel()` called before `refine()`) must leave `candidate_count()` completely unchanged.

## Generation model (mission §4.9)

See doc 27's `GenerationRecord` description. Generation 0 is always `UNKNOWN_INITIAL`'s own record; every subsequent `refine()` call appends generation N. `max_generations_retained` (default 64 via `SessionResourceLimits::default_safe()`) bounds history growth by dropping the *oldest* records first — new information is never lost in favor of old.

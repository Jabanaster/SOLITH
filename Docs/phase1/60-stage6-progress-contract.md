# Phase 1 / Stage 6 — Progress Contract

## §6.3 — authoritative not-found, centralized

**Before this mission:** no shared helper existed. Each scan path (`exact_scan.rs`, `pattern_scan.rs`, `session.rs`'s `create_unknown_initial` and `refine`) independently re-derived a structurally-similar "terminal takes precedence, else empty-skipped ⇒ Complete, else CompleteWithSkippedRegions" block — four separately-written copies of the same logic, never invoking a shared function.

**Now:** `solith_scanner_core::completeness::is_authoritative_absence(completeness, match_count) -> bool` is the one function every consumer calls: `match_count == 0 && completeness.is_complete()`. It is:

- Unit-tested directly (`authoritative_absence_requires_both_zero_matches_and_complete`, `authoritative_absence_false_for_every_non_complete_variant_even_with_zero_matches`).
- Exercised against real scans for all four required surfaces (mission's "test it across: primitive, string, bytes, AOB"):
  - primitive: `incomplete_scan_never_claims_authoritative_not_found` (false case), `authoritative_not_found_is_distinct_from_incomplete_zero_matches` (true case)
  - string/byte/AOB (all three share `PatternKind`/`scan_pattern`): `zero_matches_under_unreadable_page_is_not_authoritative_not_found` (false case), `zero_matches_under_full_coverage_is_authoritative` (true case)
- Surfaced to JS as `isAuthoritativeAbsence` on both `JsExactScanOutcome` and `JsPatternScanOutcome`, proven against the real compiled addon (`exact-scan.test.js`'s and `pattern.test.js`'s tests of the same names), so a TypeScript caller never has to re-derive the rule either.

Session refinement's `output_candidate_count` was deliberately excluded from this rule — a refined candidate SET going to zero is a different concept (surviving candidates after a filter) than "a search found nothing," and folding the two together would misrepresent what "authoritative absence" means for a value-scan session.

## §6.4 — progress contract, audited

`ScanMetrics` (`completeness.rs`) is the progress struct: `regions_total`, `regions_considered`, `regions_read`, `regions_skipped`, `chunks_requested`, `chunks_read`, `chunks_partial`, `chunks_failed`, `bytes_requested`, `bytes_read`, `elapsed`, `syscall_count`. Surfaced to JS unchanged as `JsProgress`.

**Finding:** a `ScanMetrics::coverage_ratio()` method (`bytes_read / bytes_requested`) existed but was never wired into `JsProgress` and never called by any real consumer (confirmed by a full repo grep). Structurally, it could not have been trusted if it had been: `bytes_requested` accumulates progressively as each chunk is reached, not as a whole-scan total known up front, so the ratio can read `1.0` after every single chunk throughout an entire multi-region scan — exactly the "fake precision" this mission's §6.4 warns against. **This method was removed** rather than left as a trap for a future caller; the removal is a pure deletion of dead, structurally-misleading code with no behavior change for any real consumer (nothing called it).

**No percentage field is exposed today**, and this is a deliberate, documented choice, not an oversight: no field exists anywhere in this crate that holds "total bytes across the whole requested scope, computed before the scan starts" — `regions_total` is the only true up-front total, and it counts regions, not bytes. A caller wanting a percentage today would have to compute one from raw counters and would hit the same trap `coverage_ratio()` had; building a correct one (with a real up-front byte total) is future work, not attempted here without evidence of a real consumer need.

**Progress never exceeds 100% and never reports terminal completion before the terminal `ScanCompleteness` is returned** — every progress callback fires mid-loop, strictly before the function returns its final `(Vec<Match>, ScanCompleteness)` tuple; there is no code path where `on_progress` is invoked after the terminal state is already decided and returned to the caller (confirmed by inspection of `reader.rs`, `exact_scan.rs`, `pattern_scan.rs`, `session.rs`'s five progress-callback call sites — each is textually inside the per-chunk/per-span loop body, before the loop's own return statements).

## Denominator dynamism

Total requested work (`regions_total`, `bytes_requested`'s running total) does not change dynamically mid-operation in this crate's design — every scan/session operation is given its full region/candidate list up front (`&[Region]` or the session's stored candidate set) and does not discover new work during execution. There is therefore no "denominator changes mid-flight" case to document; if a future stage adds dynamic region rediscovery mid-scan, that design will need its own explicit denominator-change contract at that time.

# Phase 1 / Stage 6 — Completeness Contract Audit

## §6.2 — completeness model, audited across every native scan path

`ScanCompleteness` (`native/solith-scanner-core/src/completeness.rs`) has 7 variants. Every scan path (primitive exact scan, session `create_unknown_initial`, session `refine`, string/byte/AOB `scan_pattern`) computes its own completeness from real accumulated per-chunk/per-region outcomes during its own loop — never a hardcoded constant. 5 of the 7 variants are actually produced by real code today; 2 are declared but currently unreachable (see below).

| Variant | Meaning | Results usable? | Not-found authoritative? | Refinement can continue? | Retry allowed? | User action required? |
|---|---|---|---|---|---|---|
| `Complete` | Every considered region/chunk fully read | Yes, fully | **Yes** | Yes | N/A (nothing to retry) | No |
| `CompleteWithSkippedRegions { skipped }` | At least one region/chunk was skipped (policy-excluded, unreadable, access-denied, partial-read); every skip named with a reason | Yes, partially | No | Yes | Conceptually yes (re-scan the skipped ranges), no dedicated retry mechanism exists | No, but the caller should be shown which ranges were skipped and why |
| `Cancelled { at_byte }` | Caller requested cancellation; stopped at a safe boundary | Yes, partially (matches found before the cut are preserved — proven by `cancellation_preserves_matches_found_before_the_cancellation_point`) | No | Yes (caller re-invokes) | Yes | Yes — cancellation is a deliberate user action |
| `ProcessExited { at_byte }` | Target exited mid-operation | Yes, partially | No | **No** — the session becomes permanently stale (`verify_not_stale`) | No (target is gone) | Yes — must reattach to a new process |
| `ReadErrorLimit { skipped }` | Too many individual read failures to continue safely — distinct from the bounded-tolerance `CompleteWithSkippedRegions` | N/A — currently never constructed | N/A | N/A | N/A | N/A |
| `ResourceLimit { at_byte }` | A configured bound (bytes/results/candidates) was hit before full scope was covered | Yes, partially | No | Yes (session generation still advances) | Not meaningful (the same bound re-triggers) | Yes — raise the limit or accept partial coverage |
| `Failed { reason }` | Operation could not proceed at all | N/A — currently never constructed; real total-failure paths return `Err(ScannerError)` directly instead | N/A | N/A | N/A | N/A |

## Are these states still sufficient?

**Yes — no new state was added.** `ReadErrorLimit` and `Failed` are declared, real, deliberately-designed extension points (their doc comments already describe the exact distinction they'd carry), but no current code path constructs them: `Failed` was superseded by every genuine total-failure case simply returning `Err(ScannerError)` instead of an `Ok` result carrying a `Failed` completeness, and `ReadErrorLimit`'s "too many failures to keep tolerating individually-named skips" threshold was never implemented — today an unbounded number of skips still just accumulates into `CompleteWithSkippedRegions`.

This mission's goal #1 ("no silent incomplete scans") is already satisfied without wiring either variant: `CompleteWithSkippedRegions` is explicit and non-silent regardless of how many skips it names. Implementing a new failure-count threshold for `ReadErrorLimit` would be a genuine behavior change with no current evidence of real-world need (no bug report or fixture scenario in this codebase currently produces pathological skip counts), so per the mission's own "do not add states without a real need" instruction, this was left as a documented, real gap for a future stage rather than guessed at now.

## §6.18 — progress/completeness cross-check invariants

Each invariant below is proven by an existing real-process test, not asserted in the abstract:

| Invariant | Proof |
|---|---|
| `Complete` ⇒ terminal progress consistent with full eligible coverage | `every_primitive_type_is_found_at_its_planted_offset`, `utf8_ascii_string_is_found_at_the_planted_offset`, and every other "found intact" test assert `Complete` alongside a real match |
| `CompleteWithSkippedRegions` ⇒ `skipped.len() > 0` | `incomplete_scan_never_claims_authoritative_not_found`, `zero_matches_under_unreadable_page_is_not_authoritative_not_found`, `protection_change_to_noaccess_between_scans_is_reported_truthfully_not_as_a_crash` |
| `Cancelled` ⇒ completed work strictly less than the full requested scope | `cancellation_stops_pattern_scan_before_full_region_is_covered` (proves a far-away marker is NOT reached), `cancellation_preserves_matches_found_before_the_cancellation_point` (proves only the pre-cancellation match is present) |
| `ProcessExited` ⇒ terminal state is never `Complete` | `process_exit_during_scan_is_reported_truthfully`, `stale_target_scan_reports_process_exited_not_zero_matches` |
| `ResourceLimit` ⇒ terminal state is never `Complete` | `resource_limit_truncates_and_never_reports_complete`, `max_results_resource_limit_is_reported_truthfully` |
| `Failed` ⇒ terminal state is never `Complete` | Vacuously true — `Failed` is never constructed (see above); no code path could violate this |

No impossible state combination was found across the full test suite (185 tests, Rust side alone).

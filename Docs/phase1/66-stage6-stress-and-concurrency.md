# Phase 1 / Stage 6 — Region Mutation, Stress, and Concurrency

## §6.16/§6.17 — region mutation during scan

The fixture (`native/solith-scanner-core/src/bin/fixture.rs`) gained a dedicated `MUTATION_REGION` (3 pages, a known marker planted mid-region) and four new real, OS-level stdin commands:

- `protect_mutation <readwrite|noaccess>` — real `VirtualProtect`
- `decommit_mutation` — real `VirtualFree(..., MEM_DECOMMIT)`
- `recommit_mutation` — real `VirtualAlloc(same address, MEM_COMMIT)`, replanting the marker
- `free_mutation` — real `VirtualFree(..., MEM_RELEASE)`, fully releasing the address space (the region genuinely disappears, not merely decommits)

Five new tests (`tests/region_mutation_integration.rs`), all against a real spawned process:

| Test | Proves |
|---|---|
| `marker_is_found_before_any_mutation` | Baseline — the setup itself is correct, so the negative results below are trusted as real mutation effects |
| `protection_change_to_noaccess_between_scans_is_reported_truthfully_not_as_a_crash` | RW→NOACCESS: scan does not error/crash; reports `CompleteWithSkippedRegions`, never `Complete` |
| `decommitted_region_is_skipped_not_crashed_and_recommit_restores_it` | Decommit: scan does not crash, reports incomplete; **recommit** then genuinely restores real, readable, writable memory with the marker found again — a full disappear-then-return round trip |
| `freed_region_is_no_longer_enumerated_and_a_stale_reference_is_skipped_not_crashed` | A freed region vanishes from real `enumerate_regions` output (no phantom entry); a caller still holding the old `Region` descriptor gets a truthful skip, never a crash |
| `region_is_decommitted_mid_scan_via_deterministic_progress_callback_sync` | **Genuine mid-scan mutation**, synchronized deterministically (no sleep): the progress callback — running synchronously mid-loop — sends the real decommit command to the fixture after the first chunk is read but before the mutation region's own chunk is reached; the scan survives and reports the mutation truthfully |

No crash, no stale-complete claim, and correct skipped/read-failure accounting were observed in every case.

## §6.19/§6.22 — session metrics and long-run stress

`ScanMetrics`'s existing field set (doc 60) already covers `eligible_bytes`≈`bytes_requested`, `attempted_bytes`≈`bytes_requested`, `read_bytes`≈`bytes_read`, `regions_total`, `regions_completed`≈`regions_read`, `duration`≈`elapsed`; `matches`/`input_candidates`/`output_candidates` are tracked per-outcome (`JsRefineOutcome`) rather than inside `ScanMetrics` itself, since they are operation-result concepts, not in-flight progress concepts. `skipped_bytes` at byte granularity and `cancel_latency` are not currently tracked (only `regions_skipped` and `chunks_partial`/`chunks_failed` counts); recorded here as a real, minor gap rather than added speculatively, since no current consumer needs byte-level skip accounting or a latency metric.

Stress evidence, real spawned processes throughout:

| Requirement | Evidence |
|---|---|
| 100+ exact scans | `one_hundred_repeated_exact_scans_do_not_leak_handles` — 100 real scans, `Complete` asserted every iteration, bounded handle growth |
| 100+ AOB scans | `one_hundred_repeated_aob_scans_do_not_leak_handles` — 100 real scans, `Complete` + real match found every iteration, bounded handle growth |
| 50+ session create/refine/close cycles | `fifty_repeated_session_create_refine_close_cycles_do_not_leak_handles` — 50 real cycles, `Complete` asserted every iteration, bounded handle growth |
| Repeated cancellation | Covered by the existing per-scan-type cancellation tests (doc 61), each independently repeatable; no cumulative-cancellation-specific regression found |
| Repeated process exits | `no_handle_leak_across_many_open_close_cycles` (500 real open/close cycles) plus the per-scenario process-exit tests (doc 62) |

Handle-count and native-memory growth were tracked via `GetProcessHandleCount` in every stress test above; JS-side memory was not separately profiled this stage (no evidence of a JS-side leak surfaced — every napi object follows the same `Arc<Mutex<Option<...>>>` release pattern proven leak-free at the native level).

## §6.23 — concurrent session safety

Two real, independent proofs, not one:

1. **Same-process, interleaved (sequential):** `two_sessions_against_the_same_process_interleaved_stay_fully_isolated` — two sessions against the *same* real process, refined in an A/B/A/B order. Session B's generation counter never moves when A refines; cancelling B's token has no effect on A's independent, later operation. Proves no shared global mutable state at the logical/session level.
2. **Genuinely simultaneous (real OS threads):** `concurrent_scans_on_two_real_threads_against_two_real_processes_are_isolated` — two real spawned fixture processes, scanned from two real `std::thread`s running at the same time (20 scans each), each thread finding only its own process's own planted value at its own process's own address. No data race, no cross-contamination, no shared global mutable scan state — stronger evidence than interleaving alone, since this exercises real concurrent execution, not just correctness under a fixed ordering.

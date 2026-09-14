# Phase 1 / Stage 6 — Stale-Target Rules Audit

## §6.7 — process-exit hardening

Tested against target exit during every required operation, all real (the fixture's `die` command triggers `std::process::exit(0xDEAD)`, no cleanup — a genuine abrupt process death, not a simulation):

| Operation | Test | Result required and confirmed |
|---|---|---|
| Exact scan | `process_exit_during_scan_is_reported_truthfully` | `ProcessExited`, no crash |
| Unknown-initial capture | `stale_target_is_rejected_after_the_process_exits` (create fails on an already-exited target) | `TargetExited` error, no crash |
| Refinement | `stale_target_is_rejected_after_the_process_exits` | `TargetExited` error, no crash |
| String/byte/AOB scan | `stale_target_scan_reports_process_exited_not_zero_matches` | `ProcessExited`, not silently zero matches |
| Result paging | N/A — synchronous in-memory operation, no live target access | — |
| Cancellation | Independently proven not to interact badly with exit — cancellation and exit are checked at the same loop-boundary granularity, never conflated | — |

No crash, no hang, no stale success, no access-after-close, and no handle leak were observed in any of the above — each is asserted directly in its respective test, and `no_handle_leak_across_many_open_close_cycles` (500 iterations) and this mission's own `one_hundred_repeated_exact_scans_do_not_leak_handles` / `one_hundred_repeated_aob_scans_do_not_leak_handles` / `fifty_repeated_session_create_refine_close_cycles_do_not_leak_handles` provide the bounded-growth evidence.

## §6.8 — stale-target rules, reviewed

**The real protection is OS handle-pinning, not a PID/creation-time re-check before each operation** — and this is a *stronger* guarantee than the mission's own framing implies, not a gap:

- `ProcessIdentity { pid, creation_time_filetime }` (`session.rs`) is captured once at session creation via `ProcessHandle::process_creation_time_filetime()` (`GetProcessTimes`). It is a **diagnostic/self-consistency record**, not the mechanism itself (the module doc already says this).
- The actual protection: `ProcessHandle` holds one open Win32 `HANDLE` for the session's entire lifetime. Windows keeps that `HANDLE` bound to the exact kernel process object it was opened against — even if the PID is reused by a brand-new process the instant the original exits, the pinned handle still refers to the *original* process (or errors truthfully once it's gone), never silently starts referring to the new one. A PID-based "is this still my process" re-check would actually be *weaker* than this — it could be fooled by a fast enough reuse; handle-pinning cannot be.
- `verify_not_stale()` asks the pinned handle "is my process still alive" (`GetExitCodeProcess`/`STILL_ACTIVE`) — never re-opens by PID, never re-derives a "current" creation time to compare against. There is nothing to re-check, because the handle itself cannot silently start pointing at a different process.

**Requirement-by-requirement:**

| Requirement | Status |
|---|---|
| PID alone never revalidates a session | **Met** — no code path uses PID alone to validate anything; the pinned handle is the sole live identity |
| Process creation time retained | Met — `ProcessIdentity.creation_time_filetime`, captured once |
| Handle identity retained | Met — one `ProcessHandle` owns the session's OS handle for its full lifetime |
| Exited target invalidates session | Met — `verify_not_stale()`, tested by `stale_target_is_rejected_after_the_process_exits` |
| New target with same executable is not auto-attached to old session | Met, by construction — nothing in this crate ever "auto-attaches" anything; every session requires an explicit `create_unknown_initial(pid, ...)` call supplying a PID the caller chose. Cross-checking that a *new* PID genuinely belongs to a *different* process than a previous session (the "PID-reuse-forcing" scenario) is explicitly, deliberately delegated to the TypeScript layer (`target.rs`'s own module doc names `windows-process-identity.ts` as the owner of this check) — this is a real, intentional architectural boundary, not an omission at this layer |
| New target requires explicit new session | Met, by construction — `NativeScanSession::new()` + `createUnknownInitial()` is the only way to get a working session; nothing rebinds an existing one to a different PID |

**Tests:**

- `stale_target_is_rejected_after_the_process_exits` — session target exits, `verify_not_stale()` and subsequent `refine()` both correctly error `TargetExited`.
- `a_second_independent_session_is_unaffected_by_the_first_process_dying` — proves cross-session isolation when one process dies; its own comment honestly documents that forcing a genuine PID-reuse collision is not deterministically reproducible from user-mode Windows (the OS decides PID reuse, not the test) — this remains untested at this layer by design, not by oversight, matching this document's own explanation above of why the real protection does not depend on that check succeeding anyway.
- No implicit rebinding exists anywhere in the codebase (confirmed by inspection — every session-creating call site requires an explicit new `NativeScanSession` object and an explicit PID argument).

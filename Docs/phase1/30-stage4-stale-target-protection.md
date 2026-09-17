# Phase 1 / Stage 4 — Stale-Target Protection

## The scenario (mission §4.2)

```
process A starts
session created
process A exits
process B starts / PID reused or target identity changes
```

The old session must NOT be considered valid for process B.

## The actual mechanism: handle-pinning, not identity comparison

A `ScanSession` owns exactly one `ProcessHandle`, opened once at `create_unknown_initial` time, and **never re-opens a handle by PID afterward** for the rest of its lifetime. Windows keeps a process's kernel object alive for as long as any handle to it remains open — this is a documented Win32 guarantee, not an assumption this crate is making. Consequently:

- Every subsequent `ReadProcessMemory`/`GetExitCodeProcess`/`GetProcessTimes` call this session issues goes through the *same* `HANDLE` value, which the OS has bound to the *original* process object since the moment `OpenProcess` returned it.
- If process A exits, that `HANDLE` starts reporting `GetExitCodeProcess() != STILL_ACTIVE` — `verify_not_stale()`/`refine()`'s pre-flight check both observe this and return `ErrorKind::TargetExited` immediately.
- Even if the OS immediately reuses A's now-free PID for an unrelated process B, **this session's handle does not follow the PID** — it continues to refer to A's (now-zombie, exited) kernel object. There is no code path in this crate by which a `ScanSession` created against A could ever read B's memory, because it never looks PID up again; it only ever uses the handle it already has.

This is the actual, structural answer to "the old session must NOT be considered valid for process B" — it is not merely *checked*, it is **architecturally impossible** for a single `ScanSession` to ever observe a second process, by construction.

## What `ProcessIdentity` is for, then

```rust
pub struct ProcessIdentity {
    pub pid: u32,
    pub creation_time_filetime: u64,
}
```

Captured once, via the real `GetProcessTimes` Win32 call (`ProcessHandle::process_creation_time_filetime`, new in Stage 4 — see `target.rs`), at session creation. This is:

1. **The strongest reliable per-process identity value available** through this crate's current architecture (mission §4.2's "If exact Windows process creation time is available through current architecture, use it" — it is, so it's used). A `FILETIME` creation timestamp, combined with PID, is exactly the identity tuple Windows itself recommends for distinguishing two different processes that happened to reuse the same PID at different times.
2. **A diagnostic/self-consistency record**, not the mechanism that makes the protection correct — the mechanism is handle-pinning (above). `ProcessIdentity` exists so a caller (or a future stage) inspecting a session can answer "which real process, and when did it start" without re-deriving it, and so this fact is recorded and testable rather than merely assumed.

## Why this is the strongest available approach, and its honest limit

The one thing this design *cannot* do — because no code in this crate ever attempts it — is protect against a caller who explicitly discards a `ScanSession` and creates a **brand-new** one against a *reused* PID, believing it to be the same target. That is not a stale-*session* bug (the old session object, if kept, would still correctly report `TargetExited`); it would be a caller-side identity-tracking bug in whatever code decided to treat a fresh `OpenProcess(reused_pid)` result as "the same game" without checking `ProcessIdentity` (or the TypeScript layer's own richer identity checks, per `target.rs`'s existing "identity remains a TypeScript responsibility" architectural note). This crate exposes `ProcessIdentity` precisely so that caller-side check is possible; enforcing it is out of this crate's scope by the same Stage 1 architectural boundary that already keeps executable-path/identity verification in TypeScript.

## Why forcing a real PID-reuse collision in a test is not attempted

Windows, not this crate or its tests, decides which exited process's PID gets reused and when — there is no supported Win32 API to force immediate reuse of a specific just-exited PID, and empirically it does not happen reliably within a single test's short lifetime. This is the same category of environment limitation Stage 1/2 already documented for the WOW64/32-bit-target gap (P1-SCAN-001) — acknowledged explicitly rather than worked around with something that would not actually prove the property.

## What is proven instead (real, deterministic, in `tests/session_integration.rs`)

1. **`stale_target_is_rejected_after_the_process_exits`**: a session's own target really exits (`die` command, abrupt `std::process::exit`); `verify_not_stale()` and `refine()` both immediately and correctly report `ErrorKind::TargetExited` — the "half" of the scenario that is under this crate's control and fully testable.
2. **`a_second_independent_session_is_unaffected_by_the_first_process_dying`**: two independently-created sessions (`session_a` against fixture A, `session_b` against a *separately spawned* fixture B) — killing A's process leaves `session_b` completely unaffected; it continues to refine correctly against its own real, live target. This is the closest deterministic proxy available to "session A must never observe process B's memory": by construction, nothing links the two sessions' handles, so there is no mechanism by which A's staleness could leak into B's behavior, which is exactly the property the mission's scenario needs to hold.

Both tests are real spawned-process tests (no mocks), and both pass (doc 32).

## napi-layer surfacing (mission §4.14's "stale target errors")

`NativeScanSession.status()` includes `isStale: boolean`, computed live (never cached) from `verify_not_stale().is_err()` on every call. `refine()`/`createUnknownInitial()` against a stale/closed session throw a `target_exited`/`invalid_configuration`-prefixed error (per this project's stable error-kind-prefix contract, doc 22), never silently no-op or return a fabricated result.

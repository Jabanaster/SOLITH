# Phase 1 / Stage 2 — Region Enumeration

## Design

`solith_scanner_core::region::enumerate_regions(handle, start)` (`region.rs`) walks `[start, 0x00007FFFFFFF0000)` via repeated real `VirtualQueryEx` calls, advancing strictly past each returned region (`region_base.checked_add(region_size)`, refusing to wrap). Per mission §7's explicit requirements:

| Requirement | How it's met |
|---|---|
| Advance safely | Checked-add advance; a zero-size result (should not occur per Win32 semantics for a successful call, but not assumed impossible) is treated as a named stop condition (`ErrorKind::InternalInvariantViolation`), never an infinite loop. |
| Detect overflow | `region_base.checked_add(region_size)` — `None` stops enumeration with `stop_reason: AddressOverflow` rather than wrapping `address` back toward zero. |
| Avoid infinite loops | Every path through the loop body either returns or strictly increases `address`; no path leaves `address` unchanged. |
| Tolerate inaccessible gaps | `MEM_FREE` regions are simply not pushed to the result vector (not committed, nothing to scan) — enumeration continues past them without special-casing. |
| Handle process exit | On a `VirtualQueryEx` failure, `handle.status()` (`GetExitCodeProcess`) is checked; if the process has exited, `stop_reason: TargetExited` is reported. |
| Handle query failure honestly | A `VirtualQueryEx` failure that is *not* attributable to process exit is reported as `stop_reason: RegionEnumerationFailure` — never silently treated as "reached the end." |
| Never report complete enumeration when incomplete | `RegionEnumerationResult.is_complete` is `false` on every early-stop path; `true` only when the sweep actually reached the address ceiling. Verified directly: `region_over_1mib_is_fully_covered_and_sentinel_value_readable` (fixture_integration.rs) asserts `enum_result.is_complete` against a real live process. |

## Region metadata (mission §7)

`Region` carries, per the mission's minimum list: `base_address`, `size`, `allocation_base`, `commit_state` (`Committed`/`Reserved`/`Free`/`Unknown` — `MEM_COMMIT`/`MEM_RESERVE`/`MEM_FREE` preserved distinctly, not collapsed to a boolean), and `kind` (`Image`/`Mapped`/`Private`/`Unknown`, derived from `MEMORY_BASIC_INFORMATION.Type` — a field **no current TypeScript implementation reads at all**, per Stage 1 doc 01 §4/doc 06 §2.1's identified gap; this closes it). Raw `Protect`/`Type` values are also preserved verbatim (`raw_protect`, `raw_type`) for diagnostics, per the mission's "do not silently discard region metadata" instruction — normalized booleans (`is_readable`/`is_writable`/`is_executable`/`is_guard`/`is_noaccess`) are computed *from* the raw values, not instead of keeping them.

Readability classification uses an **allow-list** (`PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY`), not the deny-list `native-memory-driver.ts` uses today — a deliberate Stage 1 doc 06 §2.1 decision: an allow-list fails safe against an unrecognized future protection-flag combination (treats it as unreadable), whereas a deny-list fails unsafe (treats an unrecognized combination as readable).

## Architecture detection / WOW64 (mission §6, closing P1-SCAN-001's foundation)

`ProcessHandle::detect_architecture()` calls the real Win32 `IsWow64Process`. Result: `TargetArchitecture::X64` (8-byte pointers), `X86OnWow64` (4-byte pointers — the case P1-SCAN-001 exists to close), or `Unknown` (never defaulted to either width — `pointer_width_bytes()` returns `None` for `Unknown`, forcing callers to handle "don't know" explicitly rather than silently assuming 8).

**Real, executed evidence — negative case only**: `own_process_architecture_detects_as_x64_not_wow64` (`fixture_integration.rs`) opens a handle to this test binary's own process (a genuine, live, 64-bit process) and asserts `detect_architecture() == X64`, `is_wow64() == false`, `pointer_width_bytes() == Some(8)`. Confirmed again from JS: `NativeScanTarget.attach + enumerateRegions...` (napi test suite) asserts `target.architecture() === 'x64'` and `target.pointerWidthBytes() === 8` against the real spawned fixture process.

**Documented gap, per mission §6/§18-G's explicit instruction not to fabricate validation**: no `X86OnWow64` (positive) case has been executed. This environment has only the `x86_64-pc-windows-msvc` Rust target installed (`rustup target list --installed` confirmed no `i686-pc-windows-msvc`), so a genuine 32-bit target-process fixture cannot currently be built. The detection *code* (`IsWow64Process`, a real Win32 API, not a stub) is complete and unit/contract-tested against the one case this environment can produce (a real 64-bit process correctly reporting non-WOW64). **Real 32-bit-target validation is recorded as a required, not-yet-executed later gate** — see doc 17.

## Region selection policy (mission §8)

`RegionSelectionPolicy` (`policy.rs`) is a plain, composable, loggable data struct (`require_readable`/`require_writable`/`require_executable: Option<bool>`, `allowed_kinds`/`allowed_commit_states: Option<Vec<...>>`, `max_region_bytes: Option<u64>`) — **not** baked into `enumerate_regions()` itself. `RegionSelectionPolicy::default_writable_value_scan()` reproduces today's TypeScript scanner's implicit policy (committed, writable, readable, ≤64 MiB) as one named, explicit choice; `RegionSelectionPolicy::readable_any()` proves the model supports a materially different policy (no writability requirement, no size ceiling) without touching `region.rs` at all. `partition()` returns both the selected *and* excluded regions, each excluded region tagged `SkipReason::PolicyExcluded` when it later feeds a completeness record — so policy exclusion is as honestly recorded as an OS-level read failure, never silently absorbed.
